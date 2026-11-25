#!/usr/bin/env bash
# Install a deploy bundle (scripts/bundle.sh) on the hub container, as root.
# Run by deploy.sh (by hand) and hub-update (automatic). The new app is staged
# next to the live one and swapped in; if it does not come up, the previous app
# is put back. Data in /opt/hub/data is never touched, but a database migration
# the new version ran stays applied after a rollback.
#   bash install.sh <bundle-dir>
set -euo pipefail

SRC=$(cd "${1:?usage: install.sh <bundle-dir>}" && pwd)
APP=/opt/hub/app
NEW=/opt/hub/app.new
PREV=/opt/hub/app.prev
DATA=/opt/hub/data

if [[ ! -f /etc/hub/hub.env ]]; then
	install -d -m 750 -o root -g hub /etc/hub
	(umask 027; cat >/etc/hub/hub.env) <<EOF
EMDASH_ENCRYPTION_KEY=emdash_enc_v1_$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')
EMDASH_SITE_URL=https://hub.local
EOF
	chgrp hub /etc/hub/hub.env
	echo "Created /etc/hub/hub.env."
fi

install -d -o hub -g hub "$DATA"
rm -rf "$NEW"
cp -R "$SRC" "$NEW"
chown -R root:root "$NEW"
cd "$NEW"
CI=true pnpm install --prod --frozen-lockfile

if ! command -v caddy >/dev/null; then
	DEBIAN_FRONTEND=noninteractive apt-get install -y caddy
fi
caddy validate --config Caddyfile --adapter caddyfile >/dev/null

# Add collections new since the last deploy. Skip mode leaves existing schema,
# settings and content alone. A fresh DB is seeded by the app on first boot.
if [[ -f $DATA/hub.db ]]; then
	runuser -u hub -- node_modules/.bin/emdash seed seed.json --database "$DATA/hub.db" \
		--no-content --on-conflict skip --uploads-dir "$DATA/uploads"
	# Skip mode never adds fields to an existing collection, so apply people (phone, bio, active)
	# on its own: update mode would also overwrite site settings if given the whole seed.
	node -e 'const s=JSON.parse(require("fs").readFileSync("seed.json","utf8"));
		require("fs").writeFileSync("/tmp/people-seed.json",JSON.stringify({version:s.version,collections:s.collections.filter(c=>c.slug==="people")}))'
	runuser -u hub -- node_modules/.bin/emdash seed /tmp/people-seed.json --database "$DATA/hub.db" \
		--no-content --on-conflict update --uploads-dir "$DATA/uploads"
	rm -f /tmp/people-seed.json
fi

install -m 644 hub.service hub-update.service hub-update.timer /etc/systemd/system/
install -m 755 hub-update /usr/local/sbin/hub-update
systemctl daemon-reload
systemctl enable hub >/dev/null 2>&1

healthy() {
	for _ in $(seq 1 30); do
		curl -fs -o /dev/null http://127.0.0.1:3000/ && return 0
		sleep 1
	done
	return 1
}

rm -rf "$PREV"
[[ -d $APP ]] && mv "$APP" "$PREV"
mv "$NEW" "$APP"
cd "$APP"
systemctl restart hub
if ! healthy; then
	journalctl -u hub -n 30 --no-pager
	if [[ -d $PREV ]]; then
		echo "The new app did not start; restoring the previous one." >&2
		rm -rf "$APP"
		mv "$PREV" "$APP"
		systemctl restart hub
	fi
	exit 1
fi

if ! cmp -s Caddyfile /etc/caddy/Caddyfile; then
	install -m 644 Caddyfile /etc/caddy/Caddyfile
	systemctl reload caddy
fi
# Automatic deploys are on once /etc/hub/update.env exists (infra/README.md).
if [[ -f /etc/hub/update.env ]]; then
	systemctl enable --now hub-update.timer >/dev/null 2>&1
fi
echo "hub is up"
