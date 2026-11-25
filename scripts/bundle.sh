#!/usr/bin/env bash
# Put a finished build (pnpm build) and everything infra/install.sh needs into
# one flat directory. Used by deploy.sh and .github/workflows/deploy.yml.
#   scripts/bundle.sh <empty-out-dir>
set -euo pipefail

OUT=$(cd "${1:?usage: scripts/bundle.sh <empty-out-dir>}" && pwd)
cd "$(dirname "$0")/.."
[[ -f dist/server/entry.mjs ]] || { echo "No build found: run pnpm build first." >&2; exit 1; }

cp -R dist package.json pnpm-lock.yaml pnpm-workspace.yaml seed/seed.json \
	infra/install.sh infra/hub.service infra/Caddyfile \
	infra/hub-update infra/hub-update.service infra/hub-update.timer \
	"$OUT/"
