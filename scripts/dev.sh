#!/usr/bin/env bash
# Build the front-end (if needed) and start LoomViz in development mode on a local folder.
#
#   scripts/dev.sh                 # uses examples/ (a sample repo with a loom/ folder)
#   scripts/dev.sh ~/my-harnesses  # any folder with a loom/ subfolder
#
# Needs: uv, pnpm, Graphviz (`dot`). Then open the URL it prints (it contains the launch token).
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
workspace="$(cd "${1:-$repo/examples}" && pwd)"  # absolute, before changing directory

for tool in uv pnpm dot; do
  command -v "$tool" >/dev/null || { echo "Missing $tool (see README.md)"; exit 1; }
done

cd "$repo/frontend"
[ -d node_modules ] || pnpm install --frozen-lockfile
pnpm --silent build >/dev/null

cd "$repo/backend"
exec uv run loomviz "$workspace" "${@:2}"
