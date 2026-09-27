"""Reading the challenge TSVs, writing the two output files and validating them."""
from __future__ import annotations

import os
from typing import Dict, List

import pandas as pd


def read_tsv(path: str) -> pd.DataFrame:
    """Read a challenge TSV as strings so values like "NA" survive and ids keep leading zeros."""
    return pd.read_csv(path, sep="\t", dtype=str, keep_default_na=False, quoting=3)


def load_split(data_dir: str, split: str) -> Dict[str, pd.DataFrame]:
    """Load ``{split}_source{1,2,3}.tsv`` from ``data_dir/split`` into a dict keyed ``s1``/``s2``/``s3``.

    Missing ``country`` columns are filled with an empty label; whitespace is stripped.
    """
    frames = {}
    for k in (1, 2, 3):
        df = read_tsv(os.path.join(data_dir, split, f"{split}_source{k}.tsv"))
        for col in ("entity_id", "business_name", "business_address", "country"):
            if col not in df.columns:
                df[col] = ""
            df[col] = df[col].astype(str).str.strip()
        frames[f"s{k}"] = df[["entity_id", "business_name", "business_address", "country"]]
    return frames


def load_ground_truth(data_dir: str) -> Dict[str, List[str]]:
    """Return ``{s1_id: [matched ids]}`` from ``train/train_ground_truth.tsv`` (empty list for singletons)."""
    gt = read_tsv(os.path.join(data_dir, "train", "train_ground_truth.tsv"))
    out: Dict[str, List[str]] = {}
    for s1, m in zip(gt["source1_entity_id"].str.strip(), gt["matched_entity_ids"]):
        out[s1] = [x.strip() for x in str(m).split(",") if x.strip()]
    return out


def write_lists(path: str, s1_ids: List[str], lists: Dict[str, List[str]], col: str) -> None:
    """Write one row per S1 id with a comma-joined, de-duplicated id list under column ``col``."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(f"source1_entity_id\t{col}\n")
        for s1 in s1_ids:
            seen, ids = set(), []
            for x in lists.get(s1, []):
                if x not in seen:
                    seen.add(x)
                    ids.append(x)
            fh.write(f"{s1}\t{','.join(ids)}\n")


def validate_outputs(match_path: str, cand_path: str, s1_ids: List[str], pool_ids: set) -> List[str]:
    """Mirror every official rule on both output files and return a list of problems (empty = OK)."""
    problems: List[str] = []
    parsed = {}
    for path, col in ((match_path, "matched_entity_ids"), (cand_path, "candidate_entity_ids")):
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().split("\n")
        if lines and lines[-1] == "":
            lines = lines[:-1]
        if lines[0] != f"source1_entity_id\t{col}":
            problems.append(f"{path}: bad header {lines[0]!r}")
        rows = {}
        for i, line in enumerate(lines[1:], start=2):
            parts = line.split("\t")
            if len(parts) != 2:
                problems.append(f"{path}:{i}: expected 2 tab-separated fields")
                continue
            s1, ids = parts
            if s1 in rows:
                problems.append(f"{path}:{i}: duplicate row {s1}")
            lst = [x for x in ids.split(",")] if ids else []
            if any(x == "" or x != x.strip() for x in lst):
                problems.append(f"{path}:{i}: empty/space-padded id")
            if len(set(lst)) != len(lst):
                problems.append(f"{path}:{i}: duplicate ids in list")
            bad = [x for x in lst if x not in pool_ids]
            if bad:
                problems.append(f"{path}:{i}: ids not S2/S3 test ids: {bad[:3]}")
            rows[s1] = set(lst)
        missing = set(s1_ids) - set(rows)
        extra = set(rows) - set(s1_ids)
        if missing:
            problems.append(f"{path}: {len(missing)} S1 ids missing")
        if extra:
            problems.append(f"{path}: {len(extra)} unknown S1 ids")
        parsed[col] = rows
    for s1, m in parsed["matched_entity_ids"].items():
        if not m <= parsed["candidate_entity_ids"].get(s1, set()):
            problems.append(f"{s1}: matches not a subset of candidates")
    return problems
