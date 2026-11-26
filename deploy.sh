#!/usr/bin/env bash
# Build locally and install on the hub container over SSH. Pushes to main deploy
# automatically (infra/README.md); use this for the first install, or when
# GitHub is unreachable. The next build from main replaces whatever this installs.
#   ./deploy.sh            (HUB_HOST and OFFICE_DOMAIN from .env; see .env.example)
#   HUB_HOST=root@1.2.3.4 ./deploy.sh
set -euo pipefail

cd "$(dirname "$0")"
# The environment wins over .env, so HUB_HOST=... ./deploy.sh still works.
HOST=${HUB_HOST:-}
if [[ -f .env ]]; then source .env; fi
HOST=${HOST:-${HUB_HOST:?set HUB_HOST in .env (see .env.example)}}
# Only used when the hub has no /etc/hub/hub.env yet (first install).
SITE_URL=https://hub.${OFFICE_DOMAIN:?set OFFICE_DOMAIN in .env (see .env.example)}
SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
BUNDLE=$(mktemp -d)
trap 'rm -rf "$BUNDLE"' EXIT

pnpm install --frozen-lockfile
pnpm build
scripts/bundle.sh "$BUNDLE"

ssh "${SSH_OPTS[@]}" "$HOST" 'rm -rf /opt/hub/incoming && install -d /opt/hub/incoming'
rsync -az -e "ssh ${SSH_OPTS[*]}" "$BUNDLE/" "$HOST:/opt/hub/incoming/"
ssh "${SSH_OPTS[@]}" "$HOST" "EMDASH_SITE_URL=$(printf %q "$SITE_URL") bash /opt/hub/incoming/install.sh /opt/hub/incoming && rm -rf /opt/hub/incoming"
