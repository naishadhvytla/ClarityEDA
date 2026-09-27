"""Scalable candidate generation by multi-key hash blocking.

Each record emits several blocking keys (always prefixed with its country label, since
100 % of training matches share a country).  S1 and pool records that share any key
become candidate pairs, computed with vectorised pandas merges, so the cost is
O(records + pairs) rather than O(|S1| x |pool|).  Buckets that are too large to be
informative are skipped.  The union is then cut to the top-N pairs per S1 by a cheap
similarity score, which keeps the final candidate set small.
"""
from __future__ import annotations

from typing import Dict, List

import numpy as np
import pandas as pd
from rapidfuzz import fuzz, process


def _first_tokens(s: pd.Series, n: int) -> pd.Series:
    """First ``n`` space-separated tokens of each string."""
    return s.str.split(" ").str[:n].str.join(" ")


def make_keys(df: pd.DataFrame) -> pd.DataFrame:
    """Emit (row, 64-bit hashed key) pairs for every blocking key of every record.

    Keys (all prefixed by country):
      * ``c``: compact core name (catches spacing, legal-suffix and website variants)
      * ``t``: token-sorted core name (catches word transpositions)
      * ``p``: first 2 core tokens (catches dropped trailing words)
      * ``fn``: first core token x each address number (typos in later words)
      * ``ln``: last core token x each address number
      * ``an``: each informative address word x each address number (renamed / transliterated names)
      * ``aw``: first two informative address words (addresses without numbers, foreign-script names)
      * ``c7``: first 7 chars of compact name x first address word (typos in later words, no numbers)
    """
    row = np.arange(len(df))
    cty = df["country"].astype(str).values
    parts: List[pd.DataFrame] = []

    def add(kind: str, rows: np.ndarray, vals) -> None:
        """Append one key family, dropping empty values."""
        vals = np.asarray(vals, dtype=object)
        ok = np.array([bool(v) for v in vals])
        keys = np.array([f"{kind}|{c}|{v}" for c, v in zip(cty[rows[ok]], vals[ok])], dtype=object)
        parts.append(pd.DataFrame({"row": rows[ok].astype(np.int64),
                                   "key": pd.util.hash_array(keys, categorize=False)}))

    comp = df["compact"].values
    add("c", row, [v if len(v) >= 3 else "" for v in comp])
    add("t", row, df["tsort"].values)
    first2 = _first_tokens(df["core"], 2).values
    ntok = df["core"].str.count(" ").values + 1
    add("p", row, [v if n > 2 else "" for v, n in zip(first2, ntok)])
    toks = df["core"].str.split(" ")
    ftok, ltok = toks.str[0].values, toks.str[-1].values
    nums = df["nums"].str.split(" ").map(lambda x: [n for n in x if n][:3])
    ex = pd.DataFrame({"row": row, "n": nums.values}).explode("n").dropna()
    r = ex["row"].values.astype(np.int64)
    add("fn", r, [f"{ftok[i]}#{n}" for i, n in zip(r, ex["n"].values)])
    add("ln", r, [f"{ltok[i]}#{n}" if ltok[i] != ftok[i] else "" for i, n in zip(r, ex["n"].values)])
    aw = df["awords"].str.split(" ").map(lambda x: [w for w in x if len(w) >= 4][:3])
    ex2 = pd.DataFrame({"row": row, "w": aw.values}).explode("w").dropna()
    ex2 = ex2.merge(ex, on="row")
    add("an", ex2["row"].values.astype(np.int64), (ex2["w"] + "#" + ex2["n"]).values)
    aw1 = aw.str[0].fillna("").values
    aw2 = aw.map(lambda x: " ".join(x[:2]) if len(x) >= 2 else "").values
    add("aw", row, aw2)
    add("c7", row, [f"{c[:7]}#{a}" if len(c) >= 5 and a else "" for c, a in zip(comp, aw1)])
    return pd.concat(parts, ignore_index=True)


def key_join(qkeys: pd.DataFrame, pkeys: pd.DataFrame, max_bucket: int) -> pd.DataFrame:
    """Join S1 keys with pool keys; skip buckets with more than ``max_bucket`` pool records.
    Returns unique (q, c) pairs with ``n_keys`` = number of shared keys."""
    pk = pkeys.drop_duplicates()
    size = pk["key"].map(pk["key"].value_counts())
    pk = pk[size.values <= max_bucket]
    j = qkeys.drop_duplicates().merge(pk, on="key", suffixes=("_q", "_c"))
    g = j.groupby(["row_q", "row_c"], sort=False).size().reset_index(name="n_keys")
    return g.rename(columns={"row_q": "q", "row_c": "c"})


def cheap_score(Q: pd.DataFrame, P: pd.DataFrame, q: np.ndarray, c: np.ndarray) -> np.ndarray:
    """Fast similarity used to rank raw candidates: name token-set ratio + 0.5 x address token-set
    ratio, where a missing address on either side is replaced by the name score (no penalty)."""
    qa, pa = Q["addr"].to_numpy(object)[q], P["addr"].to_numpy(object)[c]
    a = np.asarray(process.cpdist(Q["core"].to_numpy(object)[q], P["core"].to_numpy(object)[c],
                                  scorer=fuzz.token_set_ratio, workers=-1), np.float32)
    b = np.asarray(process.cpdist(qa, pa, scorer=fuzz.token_set_ratio, workers=-1), np.float32)
    b = np.where((qa == "") | (pa == ""), a, b)
    return (a + 0.5 * b) / 150.0


def top_n_per_group(q: np.ndarray, score: np.ndarray, n: int) -> np.ndarray:
    """Boolean mask selecting the ``n`` highest-scoring rows within each group ``q``."""
    order = np.lexsort((-score, q))
    qs = q[order]
    start = np.r_[0, np.flatnonzero(qs[1:] != qs[:-1]) + 1]
    rank = np.arange(len(qs)) - np.repeat(start, np.diff(np.r_[start, len(qs)]))
    mask = np.zeros(len(q), bool)
    mask[order[rank < n]] = True
    return mask


def generate(Q: pd.DataFrame, P: pd.DataFrame, pkeys: pd.DataFrame, max_bucket: int, top_n: int) -> pd.DataFrame:
    """Full candidate generation for S1 frame ``Q`` against pool ``P`` (with precomputed pool keys).
    Returns DataFrame [q, c, n_keys, cheap] restricted to the top-N per S1."""
    pairs = key_join(make_keys(Q), pkeys, max_bucket)
    q, c = pairs["q"].values, pairs["c"].values
    pairs["cheap"] = cheap_score(Q, P, q, c)
    keep = top_n_per_group(q, pairs["cheap"].values, top_n)
    return pairs[keep].reset_index(drop=True)
