"""Exact challenge metric (macro F0.5 over S1 entities) and vectorised decoding search."""
from __future__ import annotations

import itertools
from typing import Dict, Tuple

import numpy as np
import pandas as pd


def macro_f05(tp: np.ndarray, npred: np.ndarray, ntrue: np.ndarray) -> np.ndarray:
    """Per-entity F0.5 from counts.  Singletons: 1 if nothing predicted else 0.

    F0.5 = 1.25*P*R/(0.25*P+R) simplifies to 1.25*tp / (0.25*ntrue + npred).
    ``ntrue`` must count ALL true matches, including those blocking never retrieved.
    """
    denom = 0.25 * ntrue + npred
    f = np.where(denom > 0, 1.25 * tp / np.maximum(denom, 1e-12), 0.0)
    return np.where(ntrue == 0, (npred == 0).astype(float), f)


def decode_mask(q: np.ndarray, c: np.ndarray, p: np.ndarray, n_q: int, exclusive: bool,
                t: float, r: float, g: float, excl_best: np.ndarray | None = None,
                qmax: np.ndarray | None = None) -> np.ndarray:
    """Boolean mask of predicted pairs under a decoding rule.

    exclusive: each pool record may only go to the S1 where its probability is highest.
    t: absolute probability threshold.  r: keep only if p >= r * (best p of that S1).
    g: entity gate, predict nothing for an S1 whose best p < g.
    """
    if excl_best is None:
        excl_best = best_per_group(c, p)
    if qmax is None:
        qmax = np.zeros(n_q)
        np.maximum.at(qmax, q, p)
    m = (p >= t) & (p >= r * qmax[q]) & (qmax[q] >= g)
    if exclusive:
        m &= excl_best
    return m


def best_per_group(grp: np.ndarray, p: np.ndarray) -> np.ndarray:
    """True for the (first) highest-probability pair within each group id in ``grp``."""
    order = np.lexsort((-p, grp))
    first = np.ones(len(order), bool)
    first[1:] = grp[order][1:] != grp[order][:-1]
    out = np.zeros(len(p), bool)
    out[order[first]] = True
    return out


def score_mask(q: np.ndarray, y: np.ndarray, mask: np.ndarray, ntrue: np.ndarray) -> np.ndarray:
    """Per-entity F0.5 for a predicted-pair mask (entities are 0..len(ntrue)-1)."""
    n = len(ntrue)
    tp = np.bincount(q, weights=(mask & (y == 1)).astype(float), minlength=n)
    npred = np.bincount(q, weights=mask.astype(float), minlength=n)
    return macro_f05(tp, npred, ntrue)


def search_decoding(q: np.ndarray, c: np.ndarray, p: np.ndarray, y: np.ndarray,
                    ntrue: np.ndarray) -> Tuple[Dict, float]:
    """Grid-search (exclusive, t, r, g) maximising OOF macro F0.5; returns (best params, score)."""
    n_q = len(ntrue)
    excl_best = best_per_group(c, p)
    qmax = np.zeros(n_q)
    np.maximum.at(qmax, q, p)
    best, best_s = None, -1.0
    ts = np.round(np.arange(0.1, 0.96, 0.05), 3)
    rs = [0.0, 0.5, 0.7, 0.85]
    gs = [0.0, 0.5, 0.7, 0.9]
    for ex, t, r, g in itertools.product((False, True), ts, rs, gs):
        if 0 < g <= t:
            continue  # gate below the threshold has no effect
        m = decode_mask(q, c, p, n_q, ex, t, r, g, excl_best, qmax)
        s = score_mask(q, y, m, ntrue).mean()
        if s > best_s + 1e-9:
            best, best_s = {"exclusive": ex, "t": float(t), "r": float(r), "g": float(g)}, float(s)
    return best, best_s


def breakdown(per_entity: np.ndarray, ntrue: np.ndarray, country: np.ndarray) -> Dict[str, float]:
    """Mean F0.5 overall, per country label, and for singletons vs non-singletons."""
    out = {"overall": float(per_entity.mean()),
           "singletons": float(per_entity[ntrue == 0].mean()) if (ntrue == 0).any() else float("nan"),
           "non_singletons": float(per_entity[ntrue > 0].mean()) if (ntrue > 0).any() else float("nan")}
    for lab in pd.unique(country):
        out[f"country={lab}"] = float(per_entity[country == lab].mean())
    return out
