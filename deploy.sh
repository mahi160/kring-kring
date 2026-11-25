#!/usr/bin/env bash
# Build locally and install on the hub container over SSH. Pushes to main deploy
# automatically (infra/README.md); use this for the first install, or when
# GitHub is unreachable. The next build from main replaces whatever this installs.
#   ./deploy.sh            (target root@hub.local)
#   HUB_HOST=root@1.2.3.4 ./deploy.sh
set -euo pipefail

cd "$(dirname "$0")"
HOST=${HUB_HOST:-root@hub.local}
SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
BUNDLE=$(mktemp -d)
trap 'rm -rf "$BUNDLE"' EXIT

pnpm install --frozen-lockfile
pnpm build
scripts/bundle.sh "$BUNDLE"

ssh "${SSH_OPTS[@]}" "$HOST" 'rm -rf /opt/hub/incoming && install -d /opt/hub/incoming'
rsync -az -e "ssh ${SSH_OPTS[*]}" "$BUNDLE/" "$HOST:/opt/hub/incoming/"
ssh "${SSH_OPTS[@]}" "$HOST" 'bash /opt/hub/incoming/install.sh /opt/hub/incoming && rm -rf /opt/hub/incoming'
