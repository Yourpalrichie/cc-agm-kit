#!/usr/bin/env bash
# Build the release files into dist/: module.json (with the download URL for this version)
# and module.zip (module files at the zip root, as Foundry's installer expects).
# Used by .github/workflows/release.yml; can also be run locally to check the zip.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="${GITHUB_REPOSITORY:-Yourpalrichie/cc-agm-kit}"
VERSION="$(jq -r .version module.json)"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "module.json version '$VERSION' is not x.y.z" >&2; exit 1; }

# Only these go in the zip. Anything else (README, RELEASING.md, .github, .gitignore) is dev-only.
INCLUDE=(module.json lang scripts styles templates)
[ -f LICENSE ] && INCLUDE+=(LICENSE)

rm -rf dist && mkdir -p dist/stage
# Copy tracked files only, so stray local files never ship.
git ls-files -z -- "${INCLUDE[@]}" | while IFS= read -r -d '' f; do
  mkdir -p "dist/stage/$(dirname "$f")"; cp "$f" "dist/stage/$f"
done

URL="https://github.com/$REPO/releases/download/v$VERSION/module.zip"
jq --arg url "$URL" --arg manifest "https://github.com/$REPO/releases/latest/download/module.json" \
  '.download = $url | .manifest = $manifest' module.json > dist/stage/module.json
cp dist/stage/module.json dist/module.json

(cd dist/stage && zip -qrX ../module.zip . -x '.*' -x '*/.*')
rm -rf dist/stage
echo "Built v$VERSION: dist/module.json, dist/module.zip"
