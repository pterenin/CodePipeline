#!/usr/bin/env bash

set -euo pipefail

SOURCE_REPO="${1:-$PWD}"
OUTPUT_DIR="${2:-$(pwd)/.tmp/codepipeline-public-history.git}"

if ! git filter-repo --help >/dev/null 2>&1; then
  echo "git filter-repo is required but not installed." >&2
  exit 1
fi

if [ -e "$OUTPUT_DIR" ]; then
  echo "Refusing to overwrite existing output directory: $OUTPUT_DIR" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_DIR")"

echo "Creating mirror clone from $SOURCE_REPO"
git clone --mirror "$SOURCE_REPO" "$OUTPUT_DIR"

pushd "$OUTPUT_DIR" >/dev/null

echo "Rewriting history to remove node_modules/ and dist/ from every commit"
git filter-repo --force --invert-paths --path node_modules --path dist

echo
echo "History rewrite finished in: $OUTPUT_DIR"
echo "Verification:"
git log --all -- node_modules dist || true
git count-objects -vH

cat <<'EOF'

Next steps:
  1. Run a redacted secret scan against the rewritten mirror:
     docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest git /repo --no-banner --redact --config /repo/.gitleaks.toml
  2. Inspect refs and tags in the mirror clone.
  3. Force-push from the mirror clone only after coordinating with collaborators.
EOF

popd >/dev/null
