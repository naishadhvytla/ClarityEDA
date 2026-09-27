"""Emergency streaming matcher: exact match on (country, token-sorted core name).

Reads the TSVs line by line (constant memory), maps every S2/S3 record to the unique S1 record
sharing its key, and writes both output files (candidates == matches). Keys held by more than
one S1 record are skipped as ambiguous.
Usage: python src/fast_match.py <dataset_dir> <out_dir>
"""
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalize import LEGAL, _DEV_TABLE  # noqa: E402

LEG = set(LEGAL.split())
NON = re.compile(r"[^a-z0-9]+")


def key(name: str, country: str) -> str:
    """Country + sorted core-name tokens (same cleaning as normalize.clean/core_name)."""
    t = unicodedata.normalize("NFKD", name.translate(_DEV_TABLE)).lower()
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    t = t.replace("&", " and ").replace("'", "").replace(".", "")
    toks = [x for x in NON.sub(" ", t).split() if x]
    core = [x for x in toks if x not in LEG] or toks
    return country + "|" + " ".join(sorted(core)) if core else ""


def rows(path: str):
    """Yield (id, name, address, country) tuples from a challenge TSV."""
    with open(path, encoding="utf-8") as fh:
        next(fh)
        for line in fh:
            p = line.rstrip("\n").split("\t")
            p += [""] * (4 - len(p))
            yield p[0].strip(), p[1], p[2], p[3].strip()


def main() -> None:
    """Build the S1 key index, stream the pool, write outputs."""
    data, out = sys.argv[1], sys.argv[2]
    s1_ids, idx, dup = [], {}, set()
    for eid, name, _, cty in rows(os.path.join(data, "test", "test_source1.tsv")):
        s1_ids.append(eid)
        k = key(name, cty)
        if k in idx:
            dup.add(k)
        idx[k] = eid
    matches = {}
    for src in ("test_source2.tsv", "test_source3.tsv"):
        for eid, name, _, cty in rows(os.path.join(data, "test", src)):
            k = key(name, cty)
            if k and k in idx and k not in dup:
                matches.setdefault(idx[k], []).append(eid)
    os.makedirs(out, exist_ok=True)
    for fn, col in (("matching_results.tsv", "matched_entity_ids"), ("candidate_pairs.tsv", "candidate_entity_ids")):
        with open(os.path.join(out, fn), "w") as fh:
            fh.write(f"source1_entity_id\t{col}\n")
            for s in s1_ids:
                fh.write(f"{s}\t{','.join(matches.get(s, []))}\n")
    print("S1", len(s1_ids), "non-empty", len(matches), "pairs", sum(map(len, matches.values())))


if __name__ == "__main__":
    main()
