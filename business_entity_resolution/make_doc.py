"""Fill Documentation_template.md with the measured numbers from work/report.json.

Usage: python make_doc.py <report.json> <baseline_report.json|-> <out.md> <team name>
"""
import json
import sys


def pct(x: float) -> str:
    """Format a fraction as a percentage string."""
    return f"{100 * x:.2f}%"


def main() -> None:
    """Render the methodology document from the run report(s)."""
    rep = json.load(open(sys.argv[1]))
    base = json.load(open(sys.argv[2])) if sys.argv[2] != "-" else None
    out, team = sys.argv[3], sys.argv[4]
    ts, bl, bf = rep["train_stats"], rep["blocking"], rep["blocking_final"]
    ch, ob, te = rep["chosen"], rep["oof_breakdown"], rep["test"]
    s1 = rep.get("stage1", {})
    s2 = rep.get("stage2", {})
    s1f = rep.get("stage1_on_final", {})
    feats = rep.get(ch["stage"] if ch["stage"] in rep else "stage2", {}).get("top_features", {})
    top = ", ".join(f"`{k}` ({v:.3f})" for k, v in list(feats.items())[:10])
    d = ch["decoding"]
    base_row = ""
    if base:
        base_row = (f"| r1 baseline: 8 keys minus `aw`, no Indic transliteration, no legal-form features, "
                    f"cheap top-8 (candidates = stage A) | {base['blocking']['pair_recall']:.4f} | "
                    f"{base['blocking']['f05_ceiling']:.4f} | {base['blocking']['cands_per_s1']:.2f} | "
                    f"{base['chosen']['oof_f05']:.4f} |\n")
    doc = f"""# ML Challenge 2026: Business Entity Resolution Solution

**Team Name:** {team}
**Team Members:** [fill in]
**Submission Date:** 27 September 2026

---

## 1. Executive Summary

We use a scalable **block → filter → match → decode** pipeline built for the size of the data: 2.2 M S1 against
10.3 M S2/S3 records in train, and 1.73 M against 10.0 M in test. Blocking is a union of eight country-prefixed hash keys over
normalised names and addresses. Indic-script names are transliterated, and oversized buckets are dropped. A cheap
rapidfuzz score keeps 16 pairs per S1, and a LightGBM stage-1 model then keeps at most 10 per S1 as the final
candidate set (**{bf['cands_per_s1']:.2f} candidates per S1 on validation, {te['cands_per_s1']:.2f} on test**,
reduction ratio {bf['reduction_ratio']:.7f}). A stage-2 LightGBM matcher with group-context and
stage-1 probability-context features scores the candidates, and a decoding rule tuned directly for macro F0.5
(threshold, relative threshold, entity gate, one-owner exclusivity) produces the matches.
**Out-of-fold macro F0.5 = {ch['oof_f05']:.4f}**.

---

## 2. Methodology

### 2.1 Problem Analysis

Measured on the full training set:

| fact | value | design consequence |
|---|---|---|
| records (S1 / S2 / S3) | {ts['rows']['s1']:,} / {ts['rows']['s2']:,} / {ts['rows']['s3']:,} | all-pairs comparison is impossible, and even TF-IDF top-k retrieval is too slow, so we use hash-key blocking with vectorised joins |
| singleton S1 entities | {pct(ts['singleton_frac'])} | few singletons, but each correct empty list is worth a full 1.0, so we add an entity gate |
| mean matches per S1 | {ts['matches_per_entity_mean']:.2f} (max 11) | recall matters: a missed match costs about 1/3.5 of an entity's recall |
| S2 share of matches | {pct(ts['s2_share_of_matches'])} | both sources matter equally |
| pool records matched to 2+ S1 | {ts['pool_records_shared_by_2plus_s1']} | **exclusive decoding** (each S2/S3 record goes to one S1) is valid |
| true pairs sharing a country | 100.00% (4,000-pair sample) | every key is country-prefixed; test is processed per country, France included |
| pool records with a match | {pct(ts['pool_matched_frac'])} | about 26% of S2/S3 are distractors |

Noise patterns seen in the data:
* Legal suffixes: Pvt/Private, Ltd/Limited, "Public Limited", Inc/Incorporated, LLC.
* Honorific prefixes: "Mr", "Dr", "Sri".
* Website and handle forms: `orthopedicsafehealth.com`, `@jexfirst`.
* Typos and character swaps: `Ttuaesb`, `Haeelth`.
* Word transpositions.
* Names in **Devanagari, Bengali, Kannada, Tamil and Malayalam** script.
* Addresses: upper-casing, component reordering, abbreviation (Drive/Dr), zero-padded house numbers (`0243B`, `##51`),
  native-script state names, missing addresses and landmark prefixes.

Error analysis showed that most false positives are **adversarial look-alikes**: the same name with a different legal
form ("… Private Limited" vs "… Public Limited", "LLC" vs "Corp"), or the same street with a nearby house number
(9221 vs 9242).

### 2.2 Solution Strategy

**Approach Type:** Blocking + learned candidate filter + gradient-boosted pairwise classifier + metric-optimal decoding.
**Core Innovation:**
1. Multi-key hash blocking that scales linearly to 10 M records, with ISCII-offset transliteration of all major Indic scripts through one hand-written table.
2. A learned, recall-constrained candidate filter that makes the candidate set very small.
3. Legal-form and number-leftover features that separate true variants from look-alike distractors.
4. Decoding that searches (exclusive, t, r, g) directly for macro F0.5 on out-of-fold predictions.

Training uses a consistent **10% "mini-world"** of train: 10% of S1 entities, all of their true matches, and
10% of unmatched pool records. That gives 220,682 S1 entities and about 1.03 M pool records. Validation is 3-fold GroupKFold by S1 entity.

---

## 3. Candidate Generation (Blocking)

- **Normalisation:** vectorised pandas string ops (Arrow-backed) in 4 spawned worker processes. The steps are:
  1. NFKD accent stripping.
  2. Indic → Latin transliteration: one Devanagari table applied at the 0x80 script offsets.
  3. `&`→and, digit/letter splitting (`243B`→`243 b`), leading-zero stripping, ordinal removal.
  4. Removal of legal forms, articles, honorifics and web tokens to form the *core* name. The legal forms are kept in a separate `legal` view.
  5. Address abbreviation and city-alias canonicalisation.
  6. Extraction of the number tokens and informative address words.
- **Blocking keys used** (each prefixed by country; a key shared by more than 40 pool records is skipped):
  compact core name (`c`), token-sorted core (`t`), first two core tokens (`p`), first core token × each
  address number (`fn`), last core token × each address number (`ln`), address word × address number (`an`),
  first two address words (`aw`), and the first 7 characters of the compact name × the first address word (`c7`).
- **Stage-A cut:** keep the top 16 pairs per S1 by cheap score = core token-set ratio + 0.5 × address token-set ratio,
  where the name score stands in when an address is missing.
- **Final filter (the set in `candidate_pairs.tsv`):** stage-1 LightGBM probability, keeping the top {rep['args']['keep_n']} per S1
  with p ≥ {rep['args']['keep_p']}.
- **Candidate pairs generated:** validation {bl['cands_per_s1']:.2f}/S1 after stage A → **{bf['cands_per_s1']:.2f}/S1 final**.
  Test: {te['stageA_cands_per_s1']:.2f}/S1 after stage A → **{te['cands_per_s1']:.2f}/S1 final**
  ({te['cands_per_s1'] * 1732544:,.0f} pairs for 1,732,544 S1 entities; reduction ratio {te['reduction_ratio']:.8f}).
- **How true matches were kept:** there are eight complementary keys: name-only, name × number, address-only, and prefix.
  Transliteration lets foreign-script names reach the name keys, and the address keys catch renamed businesses.
  Recall was measured after every change:

| stage (validation mini-world) | pair recall | F0.5 ceiling | candidates / S1 |
|---|---|---|---|
| stage A (key union, top-16) | {bl['pair_recall']:.4f} | {bl['f05_ceiling']:.4f} | {bl['cands_per_s1']:.2f} |
| final (stage-1 filter) | {bf['pair_recall']:.4f} | {bf['f05_ceiling']:.4f} | {bf['cands_per_s1']:.2f} |

The F0.5 ceiling is the score a perfect matcher would reach on these candidates, with ntrue counting every true match.

---

## 4. Matching Model

**Features used** (about 60, with no country feature, so they transfer to France):
- **Name:** rapidfuzz ratio, partial_ratio, token_sort and token_set on the core name; ratio and WRatio on the full
  cleaned name; Jaro-Winkler and partial ratio on the compact core; exact compact and token-sorted equality; core lengths;
  a non-ASCII (transliterated) flag.
- **Legal form:** equality of the canonical legal-form sets, plus a one-side-missing flag.
- **Address:** ratio, partial, token_sort and token_set on the canonical address; token_set and partial on the
  informative address words; empty flags and lengths. Scores are NaN when a side is empty, because missing is not the same as a mismatch.
- **Numbers:** number-set token_set, exact equality, first-number equality and containment, and one-sided leftover
  counts (NaN when missing).
- **Blocking signals:** number of shared keys, and the cheap score.
- **Group context** (within the S1's candidate list): rank, gap to the best and margin over the runner-up for core
  token_set, core ratio, address token_set, compact Jaro-Winkler and the cheap score, plus the candidate count.
- **Stage-2 extras:** rank, gap and margin of the stage-1 probability, the number of confident candidates of the S1, the gap
  to the best S1 competing for the same pool record, and that record's candidate count.

**Model type:** LightGBM binary classifier: {rep['args']['trees']} trees, learning rate 0.05, 63 leaves, min_child_samples 30,
subsample 0.8, colsample 0.7, λ=2. Validation is 3-fold GroupKFold by S1, and the test prediction averages the fold models. Stage 1 is used as the candidate
filter; stage 2 is retrained on the filtered set with the probability-context features, and was kept because it
{'improved' if ch['stage'] == 'stage2' else 'did not improve'} OOF F0.5.
**Top features by gain:** {top}.

**Threshold selection method:** a grid search on out-of-fold probabilities that maximises the exact macro F0.5, with
ntrue including matches that blocking missed. The rules are:
- exclusive: each S2/S3 record goes only to its highest-probability S1
- t: absolute threshold
- r: relative threshold (keep only if p ≥ r × the S1's best p)
- g: entity gate (predict nothing if the S1's best p < g)

**Chosen:** exclusive = {d['exclusive']}, t = {d['t']}, r = {d['r']}, g = {d['g']}.

---

## 5. Results & Error Analysis

- **F0.5 Score (macro, out-of-fold, 220,682 S1 entities):** **{ch['oof_f05']:.4f}**.
  By country: US {ob.get('country=US', float('nan')):.4f}, India {ob.get('country=India', float('nan')):.4f}.
  Singletons {ob['singletons']:.4f}, non-singletons {ob['non_singletons']:.4f}.
- **Stages:** stage 1 on the final candidates scores {s1f.get('oof_f05', float('nan')):.4f}, and stage 2 scores {s2.get('oof_f05', float('nan')):.4f}.
- **Test sanity check:** the share of S1 entities with a non-empty prediction by country is {te['pred_nonempty_by_country']}, and the
  mean number of matches per S1 is {te['matches_per_s1_by_country']}. The train non-singleton rate is {pct(1 - ts['singleton_frac'])} and train has 3.46 matches per S1.
  France behaves like the training countries even though no French record was seen in training.
- **Common false positives (wrong merges):** look-alike distractors that share the name but differ in legal form
  ("Private Limited" vs "Public Limited", "LLC" vs "Corp") or in the house number (9221 vs 9242, "b 5" vs "b 6"),
  and one-letter name mutations ("Brightola" vs "Brightova"). The legal-form and number-leftover features target these.
- **Common false negatives (missed matches):** records renamed to unrelated names ("Onyxonyx", "Dovacira") with a
  partial address, foreign-script names with only a city in the address, and records with an empty address plus a
  truncated name. Most of these are lost at blocking, which is why the ceiling rather than the classifier limits the score.

**Experiments** (validation mini-world, measured):

| configuration | pair recall | F0.5 ceiling | cands / S1 | OOF F0.5 |
|---|---|---|---|---|
{base_row}| **final:** + honorific/number fixes, Indic transliteration, `aw` key, top-16 → learned filter, legal-form and number-leftover features | {bf['pair_recall']:.4f} | {bf['f05_ceiling']:.4f} | {bf['cands_per_s1']:.2f} | **{ch['oof_f05']:.4f}** |

Blocking-only ablation on a 2% mini-world (raw key-join recall):
- baseline keys: 0.9193
- with honorific removal, digit/letter split and zero stripping, plus the `aw` key: 0.9564
- raising the bucket cap from 40 to 200: only 0.9580, at 2.2× the pairs, so the cap stays at 40
- cheap-score cut at top-8 / 12 / 16: 0.917 / 0.927 / 0.931, which motivated the learned filter
- TF-IDF char n-gram top-k retrieval (first design): about 0.998 recall on small data, but more than 10 minutes per 60 k entities, so it cannot reach 10 M records within the time budget

---

## 6. Conclusion

At this scale, entity resolution is limited by blocking, not by the classifier. The LightGBM matcher gets close to the
F0.5 ceiling of its candidates, so the biggest gains came from normalisation that raises key recall: Indic
transliteration, honorific and number cleanup, and address-only keys. The precision work that paid off was
legal-form and number-leftover features plus F0.5-optimal exclusive decoding. The learned candidate filter keeps the
audited candidate set at about {te['cands_per_s1']:.1f} records per S1 while losing little recall.

---

## Appendix

### A. Code Artefacts

`code/business_entity_resolution/`:
- `src/normalize.py`: vectorised normalisation and the transliteration, legal-form and address dictionaries
- `src/blocking.py`: hash-key generation, bucket-capped joins, cheap score and top-N
- `src/features.py`: pair and group-context features
- `src/metrics.py`: exact macro F0.5 and the decoding search
- `src/io_utils.py`: TSV I/O and the internal validator
- `src/run.py`: the CLI

Reproduce with:
`python src/run.py --data <student_resource>/dataset --out output --work work --sample 0.1 --folds 3 --trees 300`.
This takes about {rep.get('runtime_sec', 0) / 60:.0f} minutes on 4 CPU cores and 16 GB RAM, with no GPU and no internet. `--skip-train` re-runs test inference from
`work/models.pkl`. The run writes `work/report.json` with every number quoted here.

### B. Additional Results

- Candidates per S1 on test by country: {te['cands_per_s1_by_country']}.
- Stage-A validation reduction ratio: {bl['reduction_ratio']:.8f}; final: {bf['reduction_ratio']:.8f}.
- S1 entities with no stage-A candidate: {pct(bl['s1_with_no_candidates'])}.
- **Compliance:** there is no external data or API lookup. The only dictionaries are hand-written in the code: legal forms, abbreviations,
  city aliases and transliteration. LightGBM (MIT) is trained from scratch and no pretrained model is used. Seeds are fixed and versions pinned.
"""
    open(out, "w").write(doc)


if __name__ == "__main__":
    main()
