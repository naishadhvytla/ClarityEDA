"""Candidate generation: multi-view TF-IDF top-k retrieval with optional country blocking.

Each S1 record retrieves its top-k most similar S2+S3 records (cosine similarity of
L2-normalised TF-IDF vectors) under several text "views"; the union over views is the
stage-A candidate set.  Retrieval is a chunked sparse matrix product followed by
``argpartition``, so memory stays bounded regardless of dataset size.
"""
from __future__ import annotations

from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
import scipy.sparse as sp
from sklearn.feature_extraction.text import TfidfVectorizer

# view name -> (normalised column, analyzer, ngram_range, default k)
VIEWS: Dict[str, Tuple[str, str, Tuple[int, int], int]] = {
    "name_char": ("core_full", "char_wb", (2, 4), 20),
    "phon_char": ("phon", "char_wb", (2, 4), 10),
    "name_word": ("core_full", "word", (1, 1), 10),
    "addr_char": ("addr", "char_wb", (3, 4), 10),
    "combo_char": ("combo", "char_wb", (3, 4), 20),
}


def fit_views(all_records: pd.DataFrame, views: Dict = VIEWS) -> Dict[str, TfidfVectorizer]:
    """Fit one sublinear TF-IDF vectoriser per view on every record (train + test, no labels)."""
    vecs = {}
    for name, (col, analyzer, ngr, _) in views.items():
        extra = {"token_pattern": r"(?u)\b\w+\b"} if analyzer == "word" else {}
        vec = TfidfVectorizer(analyzer=analyzer, ngram_range=ngr, sublinear_tf=True, min_df=2,
                              dtype=np.float32, **extra)
        vec.fit(all_records[col].values)
        vecs[name] = vec
    return vecs


def transform_views(vecs: Dict[str, TfidfVectorizer], df: pd.DataFrame, views: Dict = VIEWS) -> Dict[str, sp.csr_matrix]:
    """Transform a normalised frame into one L2-normalised CSR matrix per view."""
    return {name: vecs[name].transform(df[views[name][0]].values).tocsr() for name in vecs}


def _topk_block(Q: sp.csr_matrix, P: sp.csr_matrix, k: int, pool_idx: np.ndarray,
                max_cells: int = 20_000_000) -> Tuple[np.ndarray, np.ndarray]:
    """Top-k pool neighbours for every row of ``Q`` (restricted to ``pool_idx``) by cosine.

    Returns (query row positions, global pool indices); zero-similarity hits are dropped.
    The product is computed in row chunks so at most ``max_cells`` dense floats exist at once.
    """
    Pb = P[pool_idx].T.tocsc()
    n_pool = len(pool_idx)
    k_eff = min(k, n_pool)
    chunk = max(1, max_cells // max(n_pool, 1))
    rows, cols = [], []
    for s in range(0, Q.shape[0], chunk):
        S = (Q[s:s + chunk] @ Pb).toarray()
        if k_eff < n_pool:
            top = np.argpartition(-S, k_eff - 1, axis=1)[:, :k_eff]
        else:
            top = np.tile(np.arange(n_pool), (S.shape[0], 1))
        vals = np.take_along_axis(S, top, axis=1)
        r = np.repeat(np.arange(s, s + S.shape[0]), top.shape[1])
        keep = vals.ravel() > 0
        rows.append(r[keep])
        cols.append(pool_idx[top.ravel()[keep]])
    if not rows:
        return np.zeros(0, np.int64), np.zeros(0, np.int64)
    return np.concatenate(rows), np.concatenate(cols)


def retrieve(q_mats: Dict[str, sp.csr_matrix], p_mats: Dict[str, sp.csr_matrix], q_country: np.ndarray,
             p_country: np.ndarray, block_by_country: bool, k_scale: float = 1.0,
             views: Dict = VIEWS) -> pd.DataFrame:
    """Union of per-view top-k neighbours for every S1 row.

    Args:
        q_mats / p_mats: per-view TF-IDF matrices of S1 rows and of the S2+S3 pool.
        q_country / p_country: country labels (open set of strings).
        block_by_country: if True, each country label is its own block; labels with no pool
            records fall back to the full pool.
        k_scale: multiplier on every view's default k.

    Returns:
        DataFrame with integer columns ``q`` (S1 row), ``c`` (pool row) and ``views_hit``
        (number of views that retrieved the pair).
    """
    n_pool = len(p_country)
    all_pool = np.arange(n_pool)
    blocks: List[Tuple[np.ndarray, np.ndarray]] = []
    if block_by_country:
        for label in pd.unique(q_country):
            qi = np.flatnonzero(q_country == label)
            pi = np.flatnonzero(p_country == label)
            blocks.append((qi, pi if len(pi) else all_pool))
    else:
        blocks.append((np.arange(len(q_country)), all_pool))
    parts = []
    for name, (_, _, _, k) in views.items():
        if name not in q_mats:
            continue
        kk = max(1, int(round(k * k_scale)))
        for qi, pi in blocks:
            if len(qi) == 0:
                continue
            r, c = _topk_block(q_mats[name][qi], p_mats[name], kk, pi)
            parts.append(np.stack([qi[r], c], axis=1))
    pairs = np.concatenate(parts) if parts else np.zeros((0, 2), np.int64)
    key = pairs[:, 0].astype(np.int64) * (n_pool + 1) + pairs[:, 1]
    uniq, counts = np.unique(key, return_counts=True)
    return pd.DataFrame({"q": (uniq // (n_pool + 1)).astype(np.int64),
                         "c": (uniq % (n_pool + 1)).astype(np.int64),
                         "views_hit": counts.astype(np.int16)})


def pair_cosine(Q: sp.csr_matrix, P: sp.csr_matrix, qi: np.ndarray, pj: np.ndarray,
                chunk: int = 500_000) -> np.ndarray:
    """Row-wise cosine between ``Q[qi[n]]`` and ``P[pj[n]]`` for every pair n (chunked)."""
    out = np.empty(len(qi), np.float32)
    for s in range(0, len(qi), chunk):
        a = Q[qi[s:s + chunk]]
        b = P[pj[s:s + chunk]]
        out[s:s + chunk] = np.asarray(a.multiply(b).sum(axis=1)).ravel()
    return out


def blocking_stats(cands: pd.DataFrame, truth_pairs: set, n_true_total: int, n_q: int, n_pool: int,
                   q_ids: np.ndarray, p_ids: np.ndarray) -> Dict[str, float]:
    """Pair recall, candidates per S1 and reduction ratio of a candidate set against ground truth."""
    hit = sum((q_ids[q], p_ids[c]) in truth_pairs for q, c in zip(cands["q"].values, cands["c"].values))
    return {
        "pairs": int(len(cands)),
        "cands_per_s1": float(len(cands) / max(n_q, 1)),
        "pair_recall": float(hit / max(n_true_total, 1)),
        "reduction_ratio": float(1 - len(cands) / max(n_q * n_pool, 1)),
    }
