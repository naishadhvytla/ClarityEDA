#!/usr/bin/env bash
# Build <team_name>_submission.zip in the exact structure the organisers require.
# Usage: ./make_package.sh <team_name> <output_dir_with_tsvs> <filled Documentation_template.md>
set -euo pipefail
TEAM="${1:?team name}"; OUT="${2:?output dir}"; DOC="${3:?Documentation_template.md}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
STAGE="$(mktemp -d)"
mkdir -p "$STAGE/output" "$STAGE/code/business_entity_resolution/src"
cp "$OUT/matching_results.tsv" "$OUT/candidate_pairs.tsv" "$STAGE/output/"
cp "$ROOT"/business_entity_resolution/src/*.py "$STAGE/code/business_entity_resolution/src/"
cp "$ROOT/business_entity_resolution/README.md" "$ROOT/business_entity_resolution/requirements.txt" \
   "$STAGE/code/business_entity_resolution/"
cp "$DOC" "$STAGE/Documentation_template.md"
rm -f "$ROOT/${TEAM}_submission.zip"
(cd "$STAGE" && zip -qr "$ROOT/${TEAM}_submission.zip" output code Documentation_template.md)
unzip -l "$ROOT/${TEAM}_submission.zip"
rm -rf "$STAGE"
