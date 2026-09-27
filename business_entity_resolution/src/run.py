"""End-to-end entity-resolution pipeline (single CLI).

    python src/run.py --data <dataset_dir> --out <output_dir>

Stages:
  1. vectorised normalisation of every record (parallel over CPU cores)          normalize.py
  2. multi-key hash blocking, cheap-score top-N cut per S1 -> candidate_pairs.tsv   blocking.py
  3. pair features + S1-group context features                                     features.py
  4. LightGBM matcher (5-fold OOF on train) + stage-2 refit with probability context
  5. decoding (threshold / relative / gate / exclusivity) tuned for OOF macro F0.5  metrics.py

Training uses a consistent "mini-world" sample of train: a fraction of S1 entities, all
of their true matches, and the same fraction of unmatched pool records, so candidate
density matches the full data while keeping the run under ~30 minutes on 4 CPU cores.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
import gc
import pickle
from multiprocessing import get_context
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.model_selection import GroupKFold

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blocking import cheap_score, key_join, make_keys, top_n_per_group  # noqa: E402
from features import add_group_context, pair_features  # noqa: E402
from io_utils import load_ground_truth, load_split, validate_outputs, write_lists  # noqa: E402
from metrics import breakdown, decode_mask, score_mask, search_decoding  # noqa: E402
from normalize import normalize_frame  # noqa: E402

T0 = time.time()
CTX_COLS = ["core_tset", "core_ratio", "addr_tset", "compact_jw", "cheap"]


def log(msg: str) -> None:
    """Print a timestamped progress message."""
    print(f"[{time.time() - T0:7.1f}s] {msg}", flush=True)


def parse_args() -> argparse.Namespace:
    """Command-line flags (see README flag table)."""
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True, help="dataset dir containing train/ and test/")
    ap.add_argument("--out", default="output", help="output dir for the two TSVs")
    ap.add_argument("--work", default="work", help="dir for report.json, pairs.npz, error dump")
    ap.add_argument("--sample", type=float, default=0.25, help="train mini-world fraction")
    ap.add_argument("--max-bucket", type=int, default=40, help="skip blocking keys shared by more pool records")
    ap.add_argument("--top-n", type=int, default=16, help="candidates kept per S1 after the cheap-score cut")
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--trees", type=int, default=400)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 4)
    ap.add_argument("--keep-n", type=int, default=10, help="final candidates kept per S1 by stage-1 probability")
    ap.add_argument("--keep-p", type=float, default=0.01, help="min stage-1 probability of a final candidate")
    return ap.parse_args()


def _norm_chunk(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Worker: normalise a chunk and compute its blocking keys (row ids local to the chunk)."""
    n = normalize_frame(df)
    return n, make_keys(n)


def normalize_parallel(df: pd.DataFrame, workers: int) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Normalise records and build blocking keys in parallel; returns (normalised frame, keys)."""
    df = df.reset_index(drop=True)
    size = max(20_000, int(np.ceil(len(df) / (workers * 4))))
    chunks = [df.iloc[s:s + size] for s in range(0, len(df), size)]
    offs = np.cumsum([0] + [len(c) for c in chunks[:-1]])
    with get_context("spawn").Pool(workers) as pool:
        res = pool.map(_norm_chunk, chunks)
    del chunks
    frames = [r[0] for r in res]
    keys = [r[1].assign(row=r[1]["row"].values + o) for r, o in zip(res, offs)]
    return pd.concat(frames, ignore_index=True), pd.concat(keys, ignore_index=True)


def train_stats(tr: Dict[str, pd.DataFrame], gt: Dict[str, List[str]]) -> Dict:
    """Ground-truth facts that drive design choices (singletons, S2/S3 share, sharing, countries)."""
    n_match = np.array([len(v) for v in gt.values()])
    owners = pd.Series([m for ms in gt.values() for m in ms])
    vc = owners.value_counts()
    return {
        "rows": {k: int(len(v)) for k, v in tr.items()},
        "countries": {k: v["country"].value_counts().to_dict() for k, v in tr.items()},
        "singleton_frac": float((n_match == 0).mean()),
        "matches_per_entity_mean": float(n_match.mean()),
        "match_count_hist": {int(k): int(v) for k, v in pd.Series(n_match).value_counts().sort_index().items()},
        "s2_share_of_matches": float(owners.str.startswith("S2").mean()),
        "pool_records_shared_by_2plus_s1": int((vc > 1).sum()),
        "pool_matched_frac": float(len(vc) / (len(tr["s2"]) + len(tr["s3"]))),
    }


def mini_world(tr: Dict[str, pd.DataFrame], gt: Dict[str, List[str]], frac: float, seed: int):
    """Sample ``frac`` of S1 entities, keep all their matches plus ``frac`` of unmatched pool records."""
    s1 = tr["s1"].sample(frac=frac, random_state=seed) if frac < 1 else tr["s1"]
    matched_sel = {m for s in s1["entity_id"] for m in gt.get(s, [])}
    matched_all = {m for ms in gt.values() for m in ms}
    pool = pd.concat([tr["s2"], tr["s3"]], ignore_index=True)
    is_m = pool["entity_id"].isin(matched_all).values
    rng = np.random.RandomState(seed)
    keep = pool["entity_id"].isin(matched_sel).values | (~is_m & (rng.rand(len(pool)) < frac))
    return s1.reset_index(drop=True), pool[keep].reset_index(drop=True)


def candidates(Q: pd.DataFrame, qkeys: pd.DataFrame, P: pd.DataFrame, pkeys: pd.DataFrame,
               max_bucket: int, top_n: int) -> pd.DataFrame:
    """Hash-join blocking + cheap-score top-N cut. Returns [q, c, n_keys, cheap]."""
    pairs = key_join(qkeys, pkeys, max_bucket)
    log(f"  raw key-join pairs: {len(pairs):,} ({len(pairs) / len(Q):.1f}/S1)")
    q, c = pairs["q"].to_numpy(np.int64), pairs["c"].to_numpy(np.int64)
    pairs["cheap"] = cheap_score(Q, P, q, c)
    keep = top_n_per_group(q, pairs["cheap"].to_numpy(), top_n)
    out = pairs[keep].reset_index(drop=True)
    log(f"  after top-{top_n} cut: {len(out):,} ({len(out) / len(Q):.2f}/S1)")
    return out


def build_X(Q: pd.DataFrame, P: pd.DataFrame, cand: pd.DataFrame) -> pd.DataFrame:
    """Feature matrix for candidate pairs (pair features + blocking signals + group context)."""
    q, c = cand["q"].to_numpy(np.int64), cand["c"].to_numpy(np.int64)
    X = pair_features(Q, P, q, c)
    X["n_keys"] = cand["n_keys"].to_numpy(np.float32)
    X["cheap"] = cand["cheap"].to_numpy(np.float32)
    return add_group_context(X, q, CTX_COLS)


def lgb_params(seed: int, n_trees: int) -> Dict:
    """LightGBM binary-classifier hyper-parameters."""
    return dict(objective="binary", n_estimators=n_trees, learning_rate=0.05, num_leaves=63,
                min_child_samples=30, subsample=0.8, subsample_freq=1, colsample_bytree=0.7, reg_lambda=2.0,
                random_state=seed, n_jobs=-1, verbose=-1, deterministic=True, force_row_wise=True)


def cv_fit_predict(X: pd.DataFrame, y: np.ndarray, groups: np.ndarray, folds: int, seed: int,
                   n_trees: int) -> Tuple[np.ndarray, List[lgb.LGBMClassifier], pd.Series]:
    """GroupKFold (grouped by S1) OOF probabilities, the fold models and mean gain importance."""
    oof = np.zeros(len(X))
    models, imp = [], pd.Series(0.0, index=X.columns)
    for f, (a, b) in enumerate(GroupKFold(n_splits=folds).split(X, y, groups)):
        m = lgb.LGBMClassifier(**lgb_params(seed + f, n_trees))
        m.fit(X.iloc[a], y[a])
        oof[b] = m.predict_proba(X.iloc[b])[:, 1]
        models.append(m)
        imp += pd.Series(m.booster_.feature_importance("gain"), index=X.columns)
        log(f"  fold {f + 1}/{folds} done")
    return oof, models, imp / imp.sum()


def predict(models: List[lgb.LGBMClassifier], X: pd.DataFrame) -> np.ndarray:
    """Average the fold models' probabilities."""
    return np.mean([m.predict_proba(X)[:, 1] for m in models], axis=0)


def prob_context(p: np.ndarray, q: np.ndarray, c: np.ndarray) -> pd.DataFrame:
    """Stage-2 features from stage-1 probabilities: rank/gap/margin within the S1 group, the
    number of confident candidates, and whether this S1 is the pool record's best S1."""
    df = add_group_context(pd.DataFrame({"p1": p}), q, ["p1"]).drop(columns=["q_size"])
    df["q_n_conf"] = np.bincount(q, weights=(p >= 0.5))[q]
    cmax = pd.Series(p).groupby(c).transform("max").to_numpy()
    df["c_gap"] = cmax - p
    df["c_n"] = np.bincount(c)[c].astype(np.float32)
    return df


def main() -> None:
    """Run the full pipeline and write outputs, report.json and pairs.npz."""
    args = parse_args()
    random.seed(args.seed)
    np.random.seed(args.seed)
    os.makedirs(args.out, exist_ok=True)
    os.makedirs(args.work, exist_ok=True)
    report: Dict = {"args": vars(args)}

    log("loading train")
    tr = load_split(args.data, "train")
    gt = load_ground_truth(args.data)
    report["train_stats"] = train_stats(tr, gt)
    log(json.dumps(report["train_stats"]))

    s1, pool = mini_world(tr, gt, args.sample, args.seed)
    del tr
    log(f"mini-world: {len(s1):,} S1, {len(pool):,} pool")
    Q, qk = normalize_parallel(s1, args.workers)
    P, pk = normalize_parallel(pool, args.workers)
    del s1, pool
    log("train normalised")
    cand = candidates(Q, qk, P, pk, args.max_bucket, args.top_n)
    del qk, pk
    q, c = cand["q"].to_numpy(np.int64), cand["c"].to_numpy(np.int64)
    q_ids, p_ids = Q["entity_id"].to_numpy(object), P["entity_id"].to_numpy(object)
    truth = {(s, m) for s in q_ids for m in gt.get(s, [])}
    ntrue = np.array([len(gt.get(s, [])) for s in q_ids], float)
    y = np.fromiter(((q_ids[a], p_ids[b]) in truth for a, b in zip(q, c)), np.int8, count=len(q))
    ceil = score_mask(q, y, y == 1, ntrue)
    report["blocking"] = {
        "cands_per_s1": float(len(cand) / len(Q)), "pair_recall": float(y.sum() / ntrue.sum()),
        "reduction_ratio": float(1 - len(cand) / (len(Q) * len(P))), "f05_ceiling": float(ceil.mean()),
        "s1_with_no_candidates": float((np.bincount(q, minlength=len(Q)) == 0).mean()),
    }
    log(f"blocking: {report['blocking']}")

    X = build_X(Q, P, cand)
    log(f"features {X.shape}")
    oof1, models1, imp1 = cv_fit_predict(X, y, q, args.folds, args.seed, args.trees)
    dec1, s1score = search_decoding(q, c, oof1, y, ntrue)
    report["stage1"] = {"oof_f05": s1score, "decoding": dec1,
                        "top_features": imp1.sort_values(ascending=False).head(15).round(4).to_dict()}
    log(f"stage 1 OOF F0.5 = {s1score:.5f} {dec1}")
    # Learned candidate filter: the stage-1 model prunes the stage-A pairs; the survivors are the
    # final candidate set (candidate_pairs.tsv) that the stage-2 matcher runs inference over.
    keep = top_n_per_group(q, oof1, args.keep_n) & (oof1 >= args.keep_p)
    ceil2 = score_mask(q[keep], y[keep], y[keep] == 1, ntrue)
    report["blocking_final"] = {
        "cands_per_s1": float(keep.sum() / len(Q)), "pair_recall": float(y[keep].sum() / ntrue.sum()),
        "reduction_ratio": float(1 - keep.sum() / (len(Q) * len(P))), "f05_ceiling": float(ceil2.mean())}
    log(f"final candidate set: {report['blocking_final']}")
    X2 = pd.concat([X[keep].reset_index(drop=True), prob_context(oof1[keep], q[keep], c[keep])], axis=1)
    q, c, y, oof1 = q[keep], c[keep], y[keep], oof1[keep]
    dec, best = search_decoding(q, c, oof1, y, ntrue)
    final_oof, stage = oof1, "stage1"
    report["stage1_on_final"] = {"oof_f05": best, "decoding": dec}
    oof2, models2, imp2 = cv_fit_predict(X2, y, q, args.folds, args.seed + 7, args.trees)
    dec2, s2score = search_decoding(q, c, oof2, y, ntrue)
    report["stage2"] = {"oof_f05": s2score, "decoding": dec2,
                        "top_features": imp2.sort_values(ascending=False).head(15).round(4).to_dict()}
    log(f"stage 2 OOF F0.5 = {s2score:.5f} {dec2}")
    if s2score > best:
        final_oof, stage, dec, best = oof2, "stage2", dec2, s2score
    report["chosen"] = {"stage": stage, "decoding": dec, "oof_f05": best}
    m = decode_mask(q, c, final_oof, len(Q), dec["exclusive"], dec["t"], dec["r"], dec["g"])
    report["oof_breakdown"] = breakdown(score_mask(q, y, m, ntrue), ntrue, Q["country"].to_numpy(object))
    report["oof_pred_nonempty_frac"] = float((np.bincount(q, weights=m, minlength=len(Q)) > 0).mean())
    log(f"OOF breakdown {report['oof_breakdown']}")
    err = pd.DataFrame({"kind": np.where(m & (y == 0), np.where(ntrue[q] == 0, "FP_singleton", "FP"),
                                         np.where(~m & (y == 1), "FN", "ok")), "p": final_oof,
                        "s1_name": Q["name"].values[q], "cand_name": P["name"].values[c],
                        "s1_addr": Q["addr"].values[q], "cand_addr": P["addr"].values[c]})
    err[err.kind != "ok"].sort_values("p", ascending=False).groupby("kind").head(30).to_csv(
        os.path.join(args.work, "oof_errors.tsv"), sep="\t", index=False)
    del X, X2, Q, P

    with open(os.path.join(args.work, "models.pkl"), "wb") as fh:
        pickle.dump({"models1": models1, "models2": models2, "stage": stage, "decoding": dec}, fh)
    gc.collect()

    # ---------------- test ----------------
    # Processed one country label at a time: every blocking key is country-prefixed, so no
    # cross-country pair can be generated and the result is identical, with a much lower memory peak.
    log("loading test")
    te = load_split(args.data, "test")
    s1_all = te["s1"]
    pool_all = pd.concat([te["s2"], te["s3"]], ignore_index=True)
    del te
    out_q, out_c, out_p, n_stage_a = [], [], [], 0
    for lab in pd.unique(s1_all["country"]):
        s1c = s1_all[s1_all["country"] == lab]
        poolc = pool_all[pool_all["country"] == lab]
        log(f"test country={lab}: {len(s1c):,} S1, {len(poolc):,} pool")
        if len(poolc) == 0:
            continue
        Qt, qkt = normalize_parallel(s1c, args.workers)
        Pt, pkt = normalize_parallel(poolc, args.workers)
        candt = candidates(Qt, qkt, Pt, pkt, args.max_bucket, args.top_n)
        del qkt, pkt
        n_stage_a += len(candt)
        tq, tc = candt["q"].to_numpy(np.int64), candt["c"].to_numpy(np.int64)
        Xt = build_X(Qt, Pt, candt)
        pt1 = predict(models1, Xt)
        keep_t = top_n_per_group(tq, pt1, args.keep_n) & (pt1 >= args.keep_p)
        tq, tc, pt1 = tq[keep_t], tc[keep_t], pt1[keep_t]
        pt = pt1
        if stage == "stage2":
            pt = predict(models2, pd.concat([Xt[keep_t].reset_index(drop=True), prob_context(pt1, tq, tc)], axis=1))
        out_q.append(Qt["entity_id"].to_numpy(object)[tq])
        out_c.append(Pt["entity_id"].to_numpy(object)[tc])
        out_p.append(pt)
        del Xt, Qt, Pt, candt
        gc.collect()
    tq_ids = s1_all["entity_id"].to_numpy(object)
    tp_ids = pool_all["entity_id"].to_numpy(object)
    cq = np.concatenate(out_q) if out_q else np.zeros(0, object)
    cc = np.concatenate(out_c) if out_c else np.zeros(0, object)
    pt = np.concatenate(out_p) if out_p else np.zeros(0)
    tq, tc = pd.Index(tq_ids).get_indexer(cq), pd.Index(tp_ids).get_indexer(cc)
    cty = s1_all["country"].to_numpy(object)
    n_pool_total = len(pool_all)
    del s1_all, pool_all
    mt = decode_mask(tq, tc, pt, len(tq_ids), dec["exclusive"], dec["t"], dec["r"], dec["g"])
    order = np.lexsort((-pt, tq))
    cand_lists: Dict[str, List[str]] = {}
    match_lists: Dict[str, List[str]] = {}
    for i in order:
        s = tq_ids[tq[i]]
        cand_lists.setdefault(s, []).append(tp_ids[tc[i]])
        if mt[i]:
            match_lists.setdefault(s, []).append(tp_ids[tc[i]])
    s1_list = list(tq_ids)
    mpath, cpath = os.path.join(args.out, "matching_results.tsv"), os.path.join(args.out, "candidate_pairs.tsv")
    write_lists(mpath, s1_list, match_lists, "matched_entity_ids")
    write_lists(cpath, s1_list, cand_lists, "candidate_entity_ids")
    problems = validate_outputs(mpath, cpath, s1_list, set(tp_ids))
    report["internal_validation"] = problems[:20] or "PASS"
    log(f"internal validation: {report['internal_validation']}")
    report["test"] = {
        "stageA_cands_per_s1": float(n_stage_a / len(tq_ids)),
        "cands_per_s1": float(len(tq) / len(tq_ids)),
        "reduction_ratio": float(1 - len(tq) / (len(tq_ids) * n_pool_total)),
        "pred_nonempty_by_country": pd.Series([bool(match_lists.get(s)) for s in s1_list]).groupby(cty).mean().round(4).to_dict(),
        "matches_per_s1_by_country": pd.Series([len(match_lists.get(s, [])) for s in s1_list]).groupby(cty).mean().round(3).to_dict(),
        "cands_per_s1_by_country": pd.Series([len(cand_lists.get(s, [])) for s in s1_list]).groupby(cty).mean().round(3).to_dict(),
    }
    log(f"test: {report['test']}")
    np.savez_compressed(os.path.join(args.work, "pairs.npz"), q=q, c=c, y=y, oof=final_oof, ntrue=ntrue,
                        tq=tq, tc=tc, test=pt)
    report["runtime_sec"] = round(time.time() - T0, 1)
    with open(os.path.join(args.work, "report.json"), "w") as fh:
        json.dump(report, fh, indent=2, default=str)
    log("done")


if __name__ == "__main__":
    main()
