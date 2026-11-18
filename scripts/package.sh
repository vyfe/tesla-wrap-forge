#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
stamp="$(date +%Y%m%d-%H%M%S)"
commit="$(git rev-parse --short HEAD 2>/dev/null || echo local)"
out="release/tesla-wrap-forge-${stamp}-${commit}.tar.gz"
mkdir -p release
tar \
  --exclude='./node_modules' \
  --exclude='./dist' \
  --exclude='./.git' \
  --exclude='./.npm-cache' \
  --exclude='./release' \
  --exclude='./docs' \
  --exclude='./samples/out' \
  --exclude='./.DS_Store' \
  -czf "$out" .
shasum -a 256 "$out" > "$out.sha256"
echo "$out"
cat "$out.sha256"
