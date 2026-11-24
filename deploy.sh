#!/usr/bin/env bash
# Build locally, copy to the hub container over SSH, install prod deps and
# restart the service. Safe to run repeatedly.
#   ./deploy.sh            (target root@hub.local)
#   HUB_HOST=root@1.2.3.4 ./deploy.sh
set -euo pipefail

cd "$(dirname "$0")"
HOST=${HUB_HOST:-root@hub.local}
SSH=(ssh -o StrictHostKeyChecking=accept-new "$HOST")

pnpm install --frozen-lockfile
pnpm build

"${SSH[@]}" 'install -d -o root -g root /opt/hub/app'
rsync -az --delete --exclude node_modules/ -e "ssh -o StrictHostKeyChecking=accept-new" \
	dist package.json pnpm-lock.yaml pnpm-workspace.yaml seed/seed.json infra/hub.service infra/Caddyfile \
	"$HOST:/opt/hub/app/"

"${SSH[@]}" bash -euo pipefail -s <<'REMOTE'
if [[ ! -f /etc/hub/hub.env ]]; then
	install -d -m 750 -o root -g hub /etc/hub
	(umask 027; cat >/etc/hub/hub.env) <<EOF
EMDASH_ENCRYPTION_KEY=emdash_enc_v1_$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')
EMDASH_SITE_URL=https://hub.local
EOF
	chgrp hub /etc/hub/hub.env
	echo "Created /etc/hub/hub.env."
fi

install -d -o hub -g hub /opt/hub/data
cd /opt/hub/app
CI=true pnpm install --prod --frozen-lockfile
# Add collections new since the last deploy. Skip mode leaves existing schema,
# settings and content alone. A fresh DB is seeded by the app on first boot.
if [[ -f /opt/hub/data/hub.db ]]; then
	runuser -u hub -- node_modules/.bin/emdash seed seed.json --database /opt/hub/data/hub.db \
		--no-content --on-conflict skip --uploads-dir /opt/hub/data/uploads
	# Skip mode never adds fields to an existing collection, so apply people (phone, bio, active)
	# on its own: update mode would also overwrite site settings if given the whole seed.
	node -e 'const s=JSON.parse(require("fs").readFileSync("seed.json","utf8"));
		require("fs").writeFileSync("/tmp/people-seed.json",JSON.stringify({version:s.version,collections:s.collections.filter(c=>c.slug==="people")}))'
	runuser -u hub -- node_modules/.bin/emdash seed /tmp/people-seed.json --database /opt/hub/data/hub.db \
		--no-content --on-conflict update --uploads-dir /opt/hub/data/uploads
	rm -f /tmp/people-seed.json
fi
install -m 644 hub.service /etc/systemd/system/hub.service
systemctl daemon-reload
systemctl enable hub >/dev/null 2>&1
systemctl restart hub

if ! command -v caddy >/dev/null; then
	DEBIAN_FRONTEND=noninteractive apt-get install -y caddy
fi
caddy validate --config Caddyfile --adapter caddyfile >/dev/null
if ! cmp -s Caddyfile /etc/caddy/Caddyfile; then
	install -m 644 Caddyfile /etc/caddy/Caddyfile
	systemctl reload caddy
fi

for _ in $(seq 1 30); do
	curl -fs -o /dev/null http://127.0.0.1/ && { echo "hub is up"; exit 0; }
	sleep 1
done
journalctl -u hub -n 30 --no-pager
exit 1
REMOTE
