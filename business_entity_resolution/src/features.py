"""Pair features for the matching model.  All string similarities use multi-threaded
``rapidfuzz.process.cpdist`` so millions of pairs are scored in seconds.  No country
feature is used, so the model transfers to countries unseen in training (France)."""
from __future__ import annotations

from typing import Dict

import numpy as np
import pandas as pd
from rapidfuzz import fuzz, process
from rapidfuzz.distance import JaroWinkler


def _cp(a: np.ndarray, b: np.ndarray, scorer, scale: float = 100.0) -> np.ndarray:
    """Element-wise rapidfuzz score between aligned string arrays, scaled to 0-1."""
    return np.asarray(process.cpdist(a, b, scorer=scorer, workers=-1, dtype=np.float32), np.float32) / scale


def _nan_if_empty(x: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Set scores to NaN where either side is empty (missing is not the same as a mismatch)."""
    x[(a == "") | (b == "")] = np.nan
    return x


def _slen(a: np.ndarray) -> np.ndarray:
    """Character length of every string in an object array."""
    return np.fromiter((len(x) for x in a), np.float32, count=len(a))


def pair_features(Q: pd.DataFrame, P: pd.DataFrame, q: np.ndarray, c: np.ndarray) -> pd.DataFrame:
    """Per-pair features for aligned S1 rows ``q`` and pool rows ``c`` of normalised frames."""
    g = lambda df, col, idx: df[col].to_numpy(dtype=object)[idx]
    f: Dict[str, np.ndarray] = {}
    na, nb = g(Q, "name", q), g(P, "name", c)
    ca, cb = g(Q, "core", q), g(P, "core", c)
    xa, xb = g(Q, "compact", q), g(P, "compact", c)
    for nm, sc in (("ratio", fuzz.ratio), ("partial", fuzz.partial_ratio), ("tsort", fuzz.token_sort_ratio),
                   ("tset", fuzz.token_set_ratio)):
        f[f"core_{nm}"] = _cp(ca, cb, sc)
    f["name_ratio"] = _cp(na, nb, fuzz.ratio)
    f["name_wratio"] = _cp(na, nb, fuzz.WRatio)
    f["compact_jw"] = _cp(xa, xb, JaroWinkler.similarity, 1.0)
    f["compact_partial"] = _cp(xa, xb, fuzz.partial_ratio)
    f["compact_eq"] = (xa == xb).astype(np.float32)
    f["tsort_eq"] = (g(Q, "tsort", q) == g(P, "tsort", c)).astype(np.float32)
    f["core_len_a"], f["core_len_b"] = _slen(ca), _slen(cb)
    f["name_nonascii_b"] = P["nonascii"].to_numpy(np.float32)[c]
    aa, ab = g(Q, "addr", q), g(P, "addr", c)
    for nm, sc in (("ratio", fuzz.ratio), ("partial", fuzz.partial_ratio), ("tsort", fuzz.token_sort_ratio),
                   ("tset", fuzz.token_set_ratio)):
        f[f"addr_{nm}"] = _nan_if_empty(_cp(aa, ab, sc), aa, ab)
    wa, wb = g(Q, "awords", q), g(P, "awords", c)
    f["aw_tset"] = _nan_if_empty(_cp(wa, wb, fuzz.token_set_ratio), wa, wb)
    f["aw_partial"] = _nan_if_empty(_cp(wa, wb, fuzz.partial_ratio), wa, wb)
    ma, mb = g(Q, "nums", q), g(P, "nums", c)
    f["nums_tset"] = _nan_if_empty(_cp(ma, mb, fuzz.token_set_ratio), ma, mb)
    f["nums_eq"] = _nan_if_empty((ma == mb).astype(np.float32), ma, mb)
    fa = np.array([s.split(" ", 1)[0] for s in ma], dtype=object)
    fb = np.array([s.split(" ", 1)[0] for s in mb], dtype=object)
    f["num1_in"] = _nan_if_empty(np.array([bool(x) and x in y.split() for x, y in zip(fa, mb)], np.float32), ma, mb)
    f["num1_eq"] = _nan_if_empty((fa == fb).astype(np.float32), ma, mb)
    la, lb = g(Q, "legal", q), g(P, "legal", c)
    f["legal_eq"] = _nan_if_empty((la == lb).astype(np.float32), la, lb)
    f["legal_one_missing"] = ((la == "") ^ (lb == "")).astype(np.float32)
    left_a = np.full(len(q), np.nan, np.float32)
    left_b = np.full(len(q), np.nan, np.float32)
    for i, (x, y) in enumerate(zip(ma, mb)):
        if x and y:
            sx, sy = set(x.split()), set(y.split())
            left_a[i], left_b[i] = len(sx - sy), len(sy - sx)
    f["nums_left_a"], f["nums_left_b"] = left_a, left_b
    f["addr_empty_a"], f["addr_empty_b"] = (aa == "").astype(np.float32), (ab == "").astype(np.float32)
    f["addr_len_a"], f["addr_len_b"] = _slen(aa), _slen(ab)
    f["src_s3"] = (g(P, "src", c) == "S3").astype(np.float32)
    return pd.DataFrame(f)


def add_group_context(feat: pd.DataFrame, q: np.ndarray, cols) -> pd.DataFrame:
    """Rank, gap-to-best and margin-over-runner-up of ``cols`` among the candidates of the same
    S1 entity, plus the candidate count.  These carry much of the precision signal."""
    out = {}
    for col in cols:
        v = feat[col].fillna(-1).to_numpy(np.float32)
        order = np.lexsort((-v, q))
        qs, vs = q[order], v[order]
        start = np.r_[0, np.flatnonzero(qs[1:] != qs[:-1]) + 1]
        lens = np.diff(np.r_[start, len(qs)])
        rank_sorted = np.arange(len(qs)) - np.repeat(start, lens)
        best = np.repeat(vs[start], lens)
        second = np.repeat(np.where(lens > 1, vs[np.minimum(start + 1, len(vs) - 1)], -1), lens)
        rank = np.empty(len(q), np.float32); rank[order] = rank_sorted
        mx = np.empty(len(q), np.float32); mx[order] = best
        sec = np.empty(len(q), np.float32); sec[order] = second
        out[f"{col}_rank"] = rank
        out[f"{col}_gap"] = mx - v
        out[f"{col}_margin"] = v - np.where(rank == 0, sec, mx)
    out["q_size"] = np.bincount(q)[q].astype(np.float32)
    return pd.concat([feat.reset_index(drop=True), pd.DataFrame(out)], axis=1)
