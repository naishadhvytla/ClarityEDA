"""Pair features: TF-IDF cosines, fuzzy string scores, structural/number agreement and
group-context (rank / gap / margin) features.  No country feature is used, so the model
transfers to countries unseen in training (France)."""
from __future__ import annotations

from typing import Dict, List

import numpy as np
import pandas as pd
from rapidfuzz import fuzz, process
from rapidfuzz.distance import JaroWinkler


def _cp(a: np.ndarray, b: np.ndarray, scorer) -> np.ndarray:
    """Element-wise rapidfuzz score between aligned string arrays (multi-threaded, scaled 0-1)."""
    res = process.cpdist(list(a), list(b), scorer=scorer, workers=-1, dtype=np.float32)
    return np.asarray(res, np.float32) / (1.0 if scorer is JaroWinkler.similarity else 100.0)


def _slen(a: np.ndarray) -> np.ndarray:
    """Character length of every string in an object array (float32)."""
    return np.fromiter((len(x) for x in a), np.float32, count=len(a))


def _nan_if_empty(x: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Replace scores with NaN where either side is an empty string (missing != mismatch)."""
    x = x.astype(np.float32)
    x[(a == "") | (b == "")] = np.nan
    return x


def _token_set_stats(a: np.ndarray, b: np.ndarray, prefix: str) -> Dict[str, np.ndarray]:
    """Jaccard, one-sided leftover counts, first/last-token equality and containment of token sets."""
    n = len(a)
    jac = np.full(n, np.nan, np.float32)
    left_a = np.zeros(n, np.float32)
    left_b = np.zeros(n, np.float32)
    first = np.zeros(n, np.float32)
    last = np.zeros(n, np.float32)
    contain = np.zeros(n, np.float32)
    for i in range(n):
        ta, tb = a[i].split(), b[i].split()
        if not ta or not tb:
            continue
        sa, sb = set(ta), set(tb)
        inter = len(sa & sb)
        jac[i] = inter / len(sa | sb)
        left_a[i] = len(sa - sb)
        left_b[i] = len(sb - sa)
        first[i] = ta[0] == tb[0]
        last[i] = ta[-1] == tb[-1]
        contain[i] = sa <= sb or sb <= sa
    return {f"{prefix}_jac": jac, f"{prefix}_left_a": left_a, f"{prefix}_left_b": left_b,
            f"{prefix}_first_eq": first, f"{prefix}_last_eq": last, f"{prefix}_contain": contain}


def _num_stats(a: np.ndarray, b: np.ndarray) -> Dict[str, np.ndarray]:
    """Number-set Jaccard and leftovers between two space-joined number strings (NaN when missing)."""
    n = len(a)
    jac = np.full(n, np.nan, np.float32)
    la = np.full(n, np.nan, np.float32)
    lb = np.full(n, np.nan, np.float32)
    for i in range(n):
        if not a[i] or not b[i]:
            continue
        sa, sb = set(a[i].split()), set(b[i].split())
        jac[i] = len(sa & sb) / len(sa | sb)
        la[i] = len(sa - sb)
        lb[i] = len(sb - sa)
    return {"num_jac": jac, "num_left_a": la, "num_left_b": lb}


def _eq_or_nan(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """1.0 if equal, 0.0 if different, NaN if either value is missing."""
    out = (a == b).astype(np.float32)
    out[(a == "") | (b == "")] = np.nan
    return out


def pair_features(Q: pd.DataFrame, P: pd.DataFrame, qi: np.ndarray, pj: np.ndarray,
                  cosines: Dict[str, np.ndarray]) -> pd.DataFrame:
    """Build the per-pair feature matrix for pairs (Q row qi[n], pool row pj[n]).

    Args:
        Q, P: normalised S1 and pool frames (see ``normalize.normalize_frame``).
        qi, pj: aligned integer row indices of each pair.
        cosines: precomputed per-view TF-IDF cosines for the same pairs.
    """
    g = lambda df, col, idx: df[col].to_numpy(dtype=object)[idx]
    f: Dict[str, np.ndarray] = {f"cos_{k}": v for k, v in cosines.items()}
    na, nb = g(Q, "name_canon", qi), g(P, "name_canon", pj)
    ca, cb = g(Q, "core", qi), g(P, "core", pj)
    for nm, sc in (("ratio", fuzz.ratio), ("partial", fuzz.partial_ratio), ("tsort", fuzz.token_sort_ratio),
                   ("tset", fuzz.token_set_ratio), ("wratio", fuzz.WRatio)):
        f[f"name_{nm}"] = _cp(na, nb, sc)
        f[f"core_{nm}"] = _cp(ca, cb, sc)
    f["compact_jw"] = _cp(g(Q, "compact", qi), g(P, "compact", pj), JaroWinkler.similarity)
    pa, pb = g(Q, "phon", qi), g(P, "phon", pj)
    f["phon_ratio"] = _cp(pa, pb, fuzz.ratio)
    f["phon_tset"] = _cp(pa, pb, fuzz.token_set_ratio)
    # DBA-aware: best token_set over main/alternate name parts on both sides.
    aa, ab = g(Q, "core_alt", qi), g(P, "core_alt", pj)
    best = f["core_tset"].copy()
    for x, y in ((ca, ab), (aa, cb), (aa, ab)):
        s = _nan_if_empty(_cp(x, y, fuzz.token_set_ratio), x, y)
        best = np.fmax(best, s)
    f["dba_best_tset"] = best
    f["has_alt_a"] = (aa != "").astype(np.float32)
    f["has_alt_b"] = (ab != "").astype(np.float32)
    # Acronym match: initials of one side equal the compact core of the other.
    ia, ib = g(Q, "initials", qi), g(P, "initials", pj)
    xa, xb = g(Q, "compact", qi), g(P, "compact", pj)
    f["acronym"] = (((ia == xb) & (_slen(ia) >= 2)) |
                    ((ib == xa) & (_slen(ib) >= 2)) | ((ia == ib) & (_slen(ia) >= 2))).astype(np.float32)
    f["compact_eq"] = (xa == xb).astype(np.float32)
    f["compact_sub"] = np.array([(u in v or v in u) if u and v else False for u, v in zip(xa, xb)], np.float32)
    la = _slen(ca)
    lb = _slen(cb)
    f["core_len_a"], f["core_len_b"] = la, lb
    f["core_len_diff"] = np.abs(la - lb)
    f["core_ntok_a"] = np.array([len(s.split()) for s in ca], np.float32)
    f["core_ntok_b"] = np.array([len(s.split()) for s in cb], np.float32)
    f.update(_token_set_stats(ca, cb, "core"))
    # Addresses.
    ada, adb = g(Q, "addr", qi), g(P, "addr", pj)
    for nm, sc in (("ratio", fuzz.ratio), ("partial", fuzz.partial_ratio), ("tsort", fuzz.token_sort_ratio),
                   ("tset", fuzz.token_set_ratio)):
        f[f"addr_{nm}"] = _nan_if_empty(_cp(ada, adb, sc), ada, adb)
    wa, wb = g(Q, "addr_words", qi), g(P, "addr_words", pj)
    f["addrw_tset"] = _nan_if_empty(_cp(wa, wb, fuzz.token_set_ratio), wa, wb)
    f["addrw_partial"] = _nan_if_empty(_cp(wa, wb, fuzz.partial_ratio), wa, wb)
    f["addr_empty_a"] = (ada == "").astype(np.float32)
    f["addr_empty_b"] = (adb == "").astype(np.float32)
    f["addr_len_a"] = _slen(ada)
    f["addr_len_b"] = _slen(adb)
    f.update(_token_set_stats(wa, wb, "addrw"))
    # Numbers.
    f["postal_eq"] = _eq_or_nan(g(Q, "postal", qi), g(P, "postal", pj))
    f["house_eq"] = _eq_or_nan(g(Q, "house", qi), g(P, "house", pj))
    f.update(_num_stats(g(Q, "addr_nums", qi), g(P, "addr_nums", pj)))
    f["src_s3"] = np.array([x.startswith("S3") for x in g(P, "entity_id", pj)], np.float32)
    return pd.DataFrame(f)


def add_group_context(feat: pd.DataFrame, qi: np.ndarray, pj: np.ndarray, cols: List[str],
                      prefix: str = "") -> pd.DataFrame:
    """Add rank / gap-to-best / margin-over-best-competitor for ``cols`` within each S1 group
    (candidates competing for the same S1) and within each pool group (S1s competing for the
    same candidate), plus group sizes.  These carry most of the precision signal."""
    out = {}
    key = pd.DataFrame({"q": qi, "c": pj})
    for col in cols:
        v = feat[col].fillna(-1).values.astype(np.float32)
        key["v"] = v
        for side in ("q", "c"):
            grp = key.groupby(side)["v"]
            mx = grp.transform("max").values
            rank = grp.rank(ascending=False, method="min").values.astype(np.float32)
            # second-best in group: max of values excluding one instance of the maximum
            srt = key.sort_values([side, "v"], ascending=[True, False])
            second = srt.groupby(side)["v"].nth(1)
            sec_map = pd.Series(second.values, index=srt.loc[second.index, side].values)
            sec = key[side].map(sec_map).fillna(-1).values.astype(np.float32)
            is_top = v >= mx
            comp = np.where(is_top, sec, mx)
            out[f"{prefix}{col}_{side}rank"] = rank
            out[f"{prefix}{col}_{side}gap"] = mx - v
            out[f"{prefix}{col}_{side}margin"] = v - comp
    out[f"{prefix}q_size"] = key.groupby("q")["c"].transform("size").values.astype(np.float32)
    out[f"{prefix}c_size"] = key.groupby("c")["q"].transform("size").values.astype(np.float32)
    return pd.concat([feat.reset_index(drop=True), pd.DataFrame(out)], axis=1)
