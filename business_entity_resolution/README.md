# Business Entity Resolution: Amazon ML Challenge 2026

For every Source-1 record, this pipeline finds the matching Source-2 and Source-3 records. It is
tuned for macro F0.5 and keeps the candidate set small.

```
records ─► vectorised normalisation (parallel)
        ─► stage A: multi-key hash blocking (country-prefixed keys, bucket cap) ─► top-16 per S1 by cheap score
        ─► stage 1: LightGBM pair scorer ─► keep top-10 per S1 with p ≥ 0.01   ══► output/candidate_pairs.tsv
        ─► stage 2: LightGBM matcher (+ stage-1 probability context) ─► F0.5-tuned decoding ══► output/matching_results.tsv
```

Training uses a consistent 10 % "mini-world" of train: a random 10 % of S1 entities, all of their true
matches, and 10 % of the unmatched S2/S3 records. This keeps candidate density realistic and the run
around 30 minutes on 4 CPU cores and 16 GB RAM. Test inference always covers every test record.

## Setup

Python 3.11, CPU only, no GPU and no internet at run time.

```bash
pip install -r requirements.txt
```

## Run end to end

Run it from this folder. `<student_resource>` is the unzipped challenge folder containing `dataset/`.

```bash
python src/run.py --data <student_resource>/dataset --out output --work work --sample 0.1 --folds 3 --trees 300
```

This writes:

* `output/matching_results.tsv`: final matches, the file uploaded to the portal.
* `output/candidate_pairs.tsv`: the exact candidate set the stage-2 matching model scores.
* `work/report.json`: data statistics, blocking recall, reduction ratio, F0.5 ceiling, OOF scores per
  stage, country and singleton status, chosen thresholds and top features.
* `work/pairs.npz`: OOF and test probabilities, so decoding can be re-tuned without retraining.
* `work/oof_errors.tsv`: the worst out-of-fold false positives and false negatives, for error analysis.

## Validate

```bash
cd <student_resource>
python3 utils/validate_submission.py --matching <out>/matching_results.tsv \
  --candidate <out>/candidate_pairs.tsv --test-dir dataset/test
```

The pipeline also runs an internal validator that mirrors every rule and logs `internal validation: PASS`.

## Flags

| flag | default | meaning |
|---|---|---|
| `--data` | required | dataset dir containing `train/` and `test/` |
| `--out` | `output` | output dir for the two TSVs |
| `--work` | `work` | report, probabilities, error dump |
| `--sample` | 0.25 | train mini-world fraction (the submitted run used 0.1) |
| `--max-bucket` | 40 | skip a blocking key shared by more pool records than this |
| `--top-n` | 16 | stage-A candidates kept per S1 by cheap score |
| `--keep-n` / `--keep-p` | 10 / 0.01 | final candidates per S1, filtered by stage-1 probability |
| `--folds` | 5 | GroupKFold folds, grouped by S1 entity (the submitted run used 3) |
| `--trees` | 400 | LightGBM trees per model (the submitted run used 300) |
| `--seed` | 42 | global seed |
| `--workers` | #CPUs | processes used for normalisation and key generation |

## Source layout

| file | role |
|---|---|
| `src/normalize.py` | vectorised cleaning, Devanagari transliteration, legal-form and honorific removal, address canonicalisation, number extraction |
| `src/blocking.py` | multi-key hash blocking (vectorised joins, bucket cap), cheap score, top-N cut |
| `src/features.py` | rapidfuzz name/address/number features, S1-group rank/gap/margin context |
| `src/metrics.py` | exact macro F0.5 and vectorised decoding search |
| `src/io_utils.py` | TSV I/O, output writer, internal validator |
| `src/run.py` | the CLI that orchestrates everything |

## Rules compliance

* **No external data:** the pipeline makes no API calls, registry lookups or geocoding requests and
  downloads nothing. The only dictionaries are hand-written ones in `normalize.py` (legal forms, street
  and locality abbreviations, state codes, historic city names).
* **Models:** LightGBM (MIT) gradient-boosted trees trained from scratch on the provided train labels.
  No pretrained model is used.
* **Open country set:** country is used only as a prefix of the blocking keys, and every label, including ones
  unseen in training such as France, is its own block. There is no country feature, and every test S1
  entity is written to both outputs.
* **Deterministic:** fixed seeds, `deterministic=True` in LightGBM and pinned versions in `requirements.txt`.
* **Tab-separated I/O** with `dtype=str, keep_default_na=False`, so names like "NA" survive.
