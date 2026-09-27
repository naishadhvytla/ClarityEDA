"""End-to-end entity-resolution pipeline (single CLI).

    python src/run.py --data <dataset_dir> --out <output_dir>

Stages:
  A. multi-view TF-IDF top-k retrieval (blocking.py)                -> broad pool
  B. stage-1 LightGBM on pair features; keep the top few per S1       -> candidate_pairs.tsv
  C. stage-2 LightGBM on the pruned candidates with stage-1 context  -> matching model
  D. decoding (threshold / relative / gate / exclusivity) tuned on out-of-fold F0.5
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.model_selection import GroupKFold

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blocking import VIEWS, fit_views, pair_cosine, retrieve, transform_views  # noqa: E402
from features import add_group_context, pair_features  # noqa: E402
from io_utils import load_ground_truth, load_split, validate_outputs, write_lists  # noqa: E402
from metrics import best_per_group, breakdown, decode_mask, score_mask, search_decoding  # noqa: E402
from normalize import normalize_frame  # noqa: E402

T0 = time.time()


def log(msg: str) -> None:
    """Print a timestamped progress message."""
    print(f"[{time.time() - T0:7.1f}s] {msg}", flush=True)


def set_seed(seed: int) -> None:
    """Fix Python and NumPy RNG seeds for determinism."""
    random.seed(seed)
    np.random.seed(seed)


def parse_args() -> argparse.Namespace:
    """Command-line flags (see README flag table)."""
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True, help="dataset dir containing train/ and test/")
    ap.add_argument("--out", default="output", help="output dir for the two TSVs")
    ap.add_argument("--work", default="work", help="dir for report.json, pairs.npz, error dumps")
    ap.add_argument("--k-scale", type=float, default=1.0, help="multiplier on every view's top-k")
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--seeds", type=int, default=1, help="number of seeds averaged per fold")
    ap.add_argument("--no-stage2", action="store_true", help="skip the stage-2 model")
    ap.add_argument("--sample", type=float, default=1.0, help="fraction of train S1 entities used")
    ap.add_argument("--block-by-country", choices=["auto", "yes", "no"], default="auto")
    ap.add_argument("--trees1", type=int, default=400, help="stage-1 trees")
    ap.add_argument("--trees2", type=int, default=800, help="stage-2 trees")
    ap.add_argument("--max-recall-loss", type=float, default=0.003,
                    help="max fraction of stage-A true pairs the candidate pruning may drop")
    ap.add_argument("--no-emb", action="store_true", help="kept for CLI compatibility; embeddings are off by default")
    ap.add_argument("--emb-model", default="", help="optional sentence-transformers model for an extra view")
    return ap.parse_args()


# --------------------------------------------------------------------------------------
# data statistics
# --------------------------------------------------------------------------------------

def train_stats(tr: Dict[str, pd.DataFrame], gt: Dict[str, List[str]]) -> Dict:
    """Ground-truth facts that drive design choices (singletons, S2/S3 share, cross-country, sharing)."""
    country = pd.concat([tr["s1"], tr["s2"], tr["s3"]]).set_index("entity_id")["country"].to_dict()
    n_match = np.array([len(v) for v in gt.values()])
    pairs = [(s1, m) for s1, ms in gt.items() for m in ms]
    same = np.mean([country.get(s1) == country.get(m) for s1, m in pairs]) if pairs else 1.0
    owners = pd.Series([m for _, m in pairs]).value_counts()
    return {
        "rows": {k: int(len(v)) for k, v in tr.items()},
        "countries": {k: v["country"].value_counts().to_dict() for k, v in tr.items()},
        "singleton_frac": float((n_match == 0).mean()),
        "matches_per_entity_mean": float(n_match.mean()),
        "matches_per_nonsingleton_mean": float(n_match[n_match > 0].mean()) if (n_match > 0).any() else 0.0,
        "match_count_hist": {int(k): int(v) for k, v in pd.Series(n_match).value_counts().sort_index().items()},
        "s2_share": float(np.mean([m.startswith("S2") for _, m in pairs])) if pairs else 0.0,
        "same_country_frac": float(same),
        "pool_records_shared_by_2plus_s1": int((owners > 1).sum()),
        "pool_records_matched_frac": {k: float(tr[k]["entity_id"].isin(owners.index).mean()) for k in ("s2", "s3")},
    }


# --------------------------------------------------------------------------------------
# model helpers
# --------------------------------------------------------------------------------------

def lgb_params(seed: int, n_trees: int) -> Dict:
    """LightGBM binary-classifier hyper-parameters."""
    return dict(objective="binary", n_estimators=n_trees, learning_rate=0.03 if n_trees >= 600 else 0.05,
                num_leaves=63, min_child_samples=30, subsample=0.8, subsample_freq=1, colsample_bytree=0.7,
                reg_lambda=2.0, random_state=seed, n_jobs=-1, verbose=-1, deterministic=True,
                force_row_wise=True)


def cv_fit_predict(X: pd.DataFrame, y: np.ndarray, groups: np.ndarray, Xt: pd.DataFrame, folds: int,
                   seed: int, n_seeds: int, n_trees: int) -> Tuple[np.ndarray, np.ndarray, pd.Series]:
    """GroupKFold (grouped by S1) OOF probabilities for train, fold-averaged test probabilities
    and mean gain importances."""
    oof = np.zeros(len(X))
    pt = np.zeros(len(Xt))
    imp = pd.Series(0.0, index=X.columns)
    gkf = GroupKFold(n_splits=folds)
    for f, (a, b) in enumerate(gkf.split(X, y, groups)):
        for s in range(n_seeds):
            m = lgb.LGBMClassifier(**lgb_params(seed + 100 * s + f, n_trees))
            m.fit(X.iloc[a], y[a])
            oof[b] += m.predict_proba(X.iloc[b])[:, 1] / n_seeds
            pt += m.predict_proba(Xt)[:, 1] / (n_seeds * folds)
            imp += pd.Series(m.booster_.feature_importance("gain"), index=X.columns)
        log(f"  fold {f + 1}/{folds} done")
    return oof, pt, imp / imp.sum()


def prob_context(p: np.ndarray, q: np.ndarray, c: np.ndarray) -> pd.DataFrame:
    """Stage-2 context features from stage-1 probabilities (rank/gap/margin both sides, confident counts)."""
    df = add_group_context(pd.DataFrame({"p1": p}), q, c, ["p1"])
    key = pd.DataFrame({"q": q, "c": c, "hi": (p >= 0.5).astype(np.float32), "mid": (p >= 0.2).astype(np.float32)})
    df["q_n_conf"] = key.groupby("q")["hi"].transform("sum").values
    df["q_n_mid"] = key.groupby("q")["mid"].transform("sum").values
    df["c_n_conf"] = key.groupby("c")["hi"].transform("sum").values
    return df.drop(columns=["q_size", "c_size"])


# --------------------------------------------------------------------------------------
# pipeline pieces
# --------------------------------------------------------------------------------------

def build_pairs(side: Dict, vecs, block_by_country: bool, k_scale: float) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Stage-A retrieval + base features for one split. Returns (pairs [q, c, views_hit], features)."""
    qm = transform_views(vecs, side["Q"])
    pm = transform_views(vecs, side["P"])
    cands = retrieve(qm, pm, side["Q"]["country"].values, side["P"]["country"].values, block_by_country, k_scale)
    log(f"  retrieved {len(cands):,} pairs ({len(cands) / max(len(side['Q']), 1):.1f}/S1)")
    qi, pj = cands["q"].values, cands["c"].values
    cos = {k: pair_cosine(qm[k], pm[k], qi, pj) for k in VIEWS}
    feat = pair_features(side["Q"], side["P"], qi, pj, cos)
    feat["views_hit"] = cands["views_hit"].values.astype(np.float32)
    feat = add_group_context(feat, qi, pj, ["cos_combo_char", "cos_name_char", "core_tset", "addr_tset"])
    log(f"  features: {feat.shape}")
    return cands, feat


def choose_pruning(p: np.ndarray, q: np.ndarray, y: np.ndarray, max_loss: float) -> Dict:
    """Pick the smallest (top-N per S1, min probability) candidate filter that keeps at least
    (1 - max_loss) of the stage-A true pairs, measured on OOF stage-1 probabilities."""
    rank = pd.DataFrame({"q": q, "p": p}).groupby("q")["p"].rank(ascending=False, method="first").values
    tot = y.sum()
    best = None
    for n in (1, 2, 3, 4, 5, 6, 8, 10, 15, 20):
        for mp in (0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.0):
            keep = (rank <= n) & (p >= mp)
            loss = 1 - y[keep].sum() / max(tot, 1)
            if loss <= max_loss and (best is None or keep.sum() < best["n_pairs"]):
                best = {"top_n": n, "min_p": mp, "n_pairs": int(keep.sum()), "recall_loss": float(loss)}
    return best or {"top_n": 20, "min_p": 0.0, "n_pairs": int(len(p)), "recall_loss": 0.0}


def apply_pruning(p: np.ndarray, q: np.ndarray, rule: Dict) -> np.ndarray:
    """Boolean mask of pairs surviving the candidate filter ``rule``."""
    rank = pd.DataFrame({"q": q, "p": p}).groupby("q")["p"].rank(ascending=False, method="first").values
    return (rank <= rule["top_n"]) & (p >= rule["min_p"])


def dump_errors(path: str, Q: pd.DataFrame, P: pd.DataFrame, q: np.ndarray, c: np.ndarray, p: np.ndarray,
                y: np.ndarray, mask: np.ndarray, ntrue: np.ndarray, n: int = 30) -> None:
    """Write the worst OOF errors (FP on singletons, FP on non-singletons, FN) with names/addresses."""
    rows = []
    fp = mask & (y == 0)
    fn = (~mask) & (y == 1)
    for kind, sel in (("FP_singleton", fp & (ntrue[q] == 0)), ("FP_nonsingleton", fp & (ntrue[q] > 0)), ("FN", fn)):
        idx = np.flatnonzero(sel)
        idx = idx[np.argsort(-p[idx])] if kind.startswith("FP") else idx[np.argsort(p[idx])[::-1]]
        for i in idx[:n]:
            rows.append({"kind": kind, "p": round(float(p[i]), 4), "s1": Q["entity_id"].values[q[i]],
                         "cand": P["entity_id"].values[c[i]], "country": Q["country"].values[q[i]],
                         "s1_name": Q["business_name"].values[q[i]], "cand_name": P["business_name"].values[c[i]],
                         "s1_addr": Q["business_address"].values[q[i]], "cand_addr": P["business_address"].values[c[i]]})
    pd.DataFrame(rows).to_csv(path, sep="\t", index=False)


def main() -> None:
    """Run the full pipeline and write outputs, report.json and pairs.npz."""
    args = parse_args()
    set_seed(args.seed)
    os.makedirs(args.out, exist_ok=True)
    os.makedirs(args.work, exist_ok=True)
    report: Dict = {"args": vars(args)}

    log("loading data")
    tr = load_split(args.data, "train")
    te = load_split(args.data, "test")
    gt = load_ground_truth(args.data)
    report["train_stats"] = train_stats(tr, gt)
    log(json.dumps(report["train_stats"], indent=1, default=str))

    if args.sample < 1.0:
        keep = tr["s1"].sample(frac=args.sample, random_state=args.seed)["entity_id"]
        tr["s1"] = tr["s1"][tr["s1"]["entity_id"].isin(set(keep))]
    log("normalising")
    sides = {}
    for name, d in (("train", tr), ("test", te)):
        Q = normalize_frame(d["s1"].reset_index(drop=True))
        P = normalize_frame(pd.concat([d["s2"], d["s3"]], ignore_index=True))
        sides[name] = {"Q": Q, "P": P}
    all_rec = pd.concat([sides[s][k] for s in sides for k in ("Q", "P")], ignore_index=True)
    vecs = fit_views(all_rec)
    del all_rec

    same = report["train_stats"]["same_country_frac"]
    block = {"yes": True, "no": False}.get(args.block_by_country, same >= 0.995)
    report["block_by_country"] = bool(block)
    log(f"country blocking: {block} (same-country share of true pairs = {same:.4f})")

    log("stage A: retrieval + features (train)")
    cands_tr, X_tr = build_pairs(sides["train"], vecs, block, args.k_scale)
    log("stage A: retrieval + features (test)")
    cands_te, X_te = build_pairs(sides["test"], vecs, block, args.k_scale)

    Qtr, Ptr = sides["train"]["Q"], sides["train"]["P"]
    q_ids, p_ids = Qtr["entity_id"].values, Ptr["entity_id"].values
    truth = {(s1, m) for s1, ms in gt.items() for m in ms}
    ntrue = np.array([len(gt.get(s, [])) for s in q_ids], float)
    qtr, ctr = cands_tr["q"].values, cands_tr["c"].values
    y = np.array([(q_ids[a], p_ids[b]) in truth for a, b in zip(qtr, ctr)], np.int8)
    n_true_total = ntrue.sum()

    def ceiling(mask: np.ndarray) -> float:
        """F0.5 a perfect matcher would reach on the candidates selected by ``mask``."""
        return float(score_mask(qtr, y, mask & (y == 1), ntrue).mean())

    report["blocking_stageA"] = {
        "pairs": int(len(cands_tr)), "cands_per_s1": float(len(cands_tr) / len(q_ids)),
        "pair_recall": float(y.sum() / max(n_true_total, 1)),
        "reduction_ratio": float(1 - len(cands_tr) / (len(q_ids) * len(p_ids))),
        "f05_ceiling": ceiling(np.ones(len(y), bool)),
        "test_cands_per_s1": float(len(cands_te) / len(sides["test"]["Q"])),
    }
    log(f"stage A blocking: {report['blocking_stageA']}")

    log("stage 1 model")
    oof1, pt1, imp1 = cv_fit_predict(X_tr, y, qtr, X_te, args.folds, args.seed, args.seeds, args.trees1)
    report["stage1"] = {"top_features": imp1.sort_values(ascending=False).head(20).round(4).to_dict()}

    rule = choose_pruning(oof1, qtr, y, args.max_recall_loss)
    keep_tr = apply_pruning(oof1, qtr, rule)
    keep_te = apply_pruning(pt1, cands_te["q"].values, rule)
    report["candidate_filter"] = rule
    report["blocking_final"] = {
        "pairs": int(keep_tr.sum()), "cands_per_s1": float(keep_tr.sum() / len(q_ids)),
        "pair_recall": float(y[keep_tr].sum() / max(n_true_total, 1)),
        "reduction_ratio": float(1 - keep_tr.sum() / (len(q_ids) * len(p_ids))),
        "f05_ceiling": ceiling(keep_tr),
        "test_cands_per_s1": float(keep_te.sum() / len(sides["test"]["Q"])),
    }
    log(f"final candidates: {report['blocking_final']}")

    # Stage 2 runs on the pruned candidate set (exactly what candidate_pairs.tsv lists).
    q2, c2, y2, p1_tr = qtr[keep_tr], ctr[keep_tr], y[keep_tr], oof1[keep_tr]
    qt2, ct2, p1_te = cands_te["q"].values[keep_te], cands_te["c"].values[keep_te], pt1[keep_te]
    final_tr, final_te, stage = p1_tr, p1_te, "stage1"
    dec, best_s = search_decoding(q2, c2, p1_tr, y2, ntrue)
    report["stage1"].update({"oof_f05": best_s, "decoding": dec})
    log(f"stage 1 OOF F0.5 = {best_s:.5f} with {dec}")
    if not args.no_stage2:
        log("stage 2 model")
        base_tr = X_tr[keep_tr].reset_index(drop=True).drop(columns=[c for c in X_tr.columns if c.endswith(("rank", "gap", "margin", "_size"))])
        base_te = X_te[keep_te].reset_index(drop=True).drop(columns=[c for c in X_te.columns if c.endswith(("rank", "gap", "margin", "_size"))])
        ctx_cols = ["cos_combo_char", "cos_name_char", "core_tset", "addr_tset"]
        X2 = pd.concat([add_group_context(base_tr, q2, c2, ctx_cols), prob_context(p1_tr, q2, c2)], axis=1)
        X2t = pd.concat([add_group_context(base_te, qt2, ct2, ctx_cols), prob_context(p1_te, qt2, ct2)], axis=1)
        oof2, pt2, imp2 = cv_fit_predict(X2, y2, q2, X2t, args.folds, args.seed, args.seeds, args.trees2)
        dec2, s2 = search_decoding(q2, c2, oof2, y2, ntrue)
        report["stage2"] = {"oof_f05": s2, "decoding": dec2, "top_features": imp2.sort_values(ascending=False).head(20).round(4).to_dict()}
        log(f"stage 2 OOF F0.5 = {s2:.5f} with {dec2}")
        if s2 > best_s:
            final_tr, final_te, dec, best_s, stage = oof2, pt2, dec2, s2, "stage2"
    report["chosen"] = {"stage": stage, "decoding": dec, "oof_f05": best_s}

    m_tr = decode_mask(q2, c2, final_tr, len(q_ids), dec["exclusive"], dec["t"], dec["r"], dec["g"])
    per = score_mask(q2, y2, m_tr, ntrue)
    report["oof_breakdown"] = breakdown(per, ntrue, Qtr["country"].values)
    report["oof_pred_nonempty_frac"] = float((np.bincount(q2, weights=m_tr, minlength=len(q_ids)) > 0).mean())
    log(f"OOF breakdown: {report['oof_breakdown']}")
    dump_errors(os.path.join(args.work, "oof_errors.tsv"), Qtr, Ptr, q2, c2, final_tr, y2, m_tr, ntrue)

    # ---------------- test outputs ----------------
    Qte, Pte = sides["test"]["Q"], sides["test"]["P"]
    tq_ids, tp_ids = Qte["entity_id"].values, Pte["entity_id"].values
    m_te = decode_mask(qt2, ct2, final_te, len(tq_ids), dec["exclusive"], dec["t"], dec["r"], dec["g"])
    order = np.lexsort((-final_te, qt2))
    cand_lists: Dict[str, List[str]] = {}
    match_lists: Dict[str, List[str]] = {}
    for i in order:
        s = tq_ids[qt2[i]]
        cand_lists.setdefault(s, []).append(tp_ids[ct2[i]])
        if m_te[i]:
            match_lists.setdefault(s, []).append(tp_ids[ct2[i]])
    s1_list = list(tq_ids)
    mpath, cpath = os.path.join(args.out, "matching_results.tsv"), os.path.join(args.out, "candidate_pairs.tsv")
    write_lists(mpath, s1_list, match_lists, "matched_entity_ids")
    write_lists(cpath, s1_list, cand_lists, "candidate_entity_ids")
    problems = validate_outputs(mpath, cpath, s1_list, set(tp_ids))
    report["internal_validation"] = problems or "PASS"
    log(f"internal validation: {problems[:10] if problems else 'PASS'}")

    nonempty = pd.Series({s: bool(match_lists.get(s)) for s in s1_list})
    report["test_pred_nonempty_frac_by_country"] = nonempty.groupby(Qte["country"].values).mean().round(4).to_dict()
    report["test_cands_per_s1_by_country"] = pd.Series([len(cand_lists.get(s, [])) for s in s1_list]).groupby(Qte["country"].values).mean().round(3).to_dict()
    report["train_nonsingleton_frac"] = float((ntrue > 0).mean())
    log(f"test non-empty by country: {report['test_pred_nonempty_frac_by_country']} (train non-singleton frac {report['train_nonsingleton_frac']:.3f})")

    np.savez_compressed(os.path.join(args.work, "pairs.npz"), q=q2, c=c2, y=y2, oof=final_tr, oof1=p1_tr,
                        tq=qt2, tc=ct2, test=final_te, test1=p1_te, ntrue=ntrue)
    report["runtime_sec"] = round(time.time() - T0, 1)
    with open(os.path.join(args.work, "report.json"), "w") as fh:
        json.dump(report, fh, indent=2, default=str)
    log("done")


if __name__ == "__main__":
    main()
