#!/usr/bin/env sh
set -eu

INDEX="${AFI_VECTORIZE_INDEX:-afilmory-photo-embeddings}"

if cf vectorize get "$INDEX" --quiet >/dev/null 2>&1; then
  printf 'Vectorize index already exists: %s\n' "$INDEX"
  exit 0
fi

printf 'Creating Vectorize index: %s\n' "$INDEX"
cf vectorize create \
  --name "$INDEX" \
  --index-config-dimensions 1024 \
  --index-config-metric cosine \
  --description "Afilmory photo semantic search"
