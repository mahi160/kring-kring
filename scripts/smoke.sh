#!/usr/bin/env bash
# Smoke check: build, seed a throwaway DB with fixture announcements, run the
# production server and assert the homepage shows current ones, pinned first,
# and upcoming events in date order.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$PWD
PORT=${SMOKE_PORT:-4399}
TMP=$(mktemp -d)
SERVER_PID=
cleanup() {
	if [[ -n $SERVER_PID ]]; then
		kill "$SERVER_PID" 2>/dev/null || true
		wait "$SERVER_PID" 2>/dev/null || true
	fi
	rm -rf "$TMP"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

[[ ${SKIP_BUILD:-} == 1 ]] || pnpm build >/dev/null

mkdir -p "$TMP/data"
npx emdash seed seed/seed.json --database "$TMP/data/hub.db" --no-content >/dev/null
npx emdash seed tests/fixtures/announcements.seed.json --database "$TMP/data/hub.db" >/dev/null

(
	cd "$TMP"
	EMDASH_ENCRYPTION_KEY="emdash_enc_v1_$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')" \
		EMDASH_SITE_URL="http://127.0.0.1:$PORT" HOST=127.0.0.1 PORT=$PORT \
		exec node "$ROOT/dist/server/entry.mjs"
) >"$TMP/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 50); do
	curl -fs "http://127.0.0.1:$PORT/" -o "$TMP/home.html" && break
	sleep 0.2
done
[[ -s $TMP/home.html ]] || { cat "$TMP/server.log" >&2; fail "homepage did not load"; }

html=$(<"$TMP/home.html")
grep -q "SMOKE pinned notice" <<<"$html" || fail "pinned announcement missing"
grep -q "SMOKE regular notice" <<<"$html" || fail "regular announcement missing"
grep -q "SMOKE expired notice" <<<"$html" && fail "expired announcement shown"
grep -q "SMOKE draft notice" <<<"$html" && fail "draft announcement shown"
pinned_at=$(grep -bo "SMOKE pinned notice" <<<"$html" | head -1 | cut -d: -f1)
regular_at=$(grep -bo "SMOKE regular notice" <<<"$html" | head -1 | cut -d: -f1)
((pinned_at < regular_at)) || fail "pinned announcement is not first"
grep -q "SMOKE past event" <<<"$html" && fail "past event shown"
sooner_at=$(grep -bo "SMOKE sooner event" <<<"$html" | head -1 | cut -d: -f1)
later_at=$(grep -bo "SMOKE later event" <<<"$html" | head -1 | cut -d: -f1)
[[ -n $sooner_at && -n $later_at ]] || fail "upcoming events missing"
((sooner_at < later_at)) || fail "events are not in date order"

BASE="http://127.0.0.1:$PORT"
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
for path in /quiz /people /gallery /ideas /handbook /holidays; do
	[[ $(status "$BASE$path") == 200 ]] || fail "$path did not load"
done
grep -q 'data-theme="' <<<"$html" || fail "no colour theme on the page"
[[ $(status "$BASE/people/me") == 303 ]] || fail "/people/me should send signed-out visitors to sign in"
[[ $(status -X POST -H 'Origin: http://evil.example' "$BASE/news-refresh") == 403 ]] || fail "cross-site news refresh allowed"
[[ $(status -X POST -H 'Origin: http://evil.example' "$BASE/gallery") == 403 ]] || fail "cross-site gallery upload allowed"
[[ $(status -X POST -H 'Origin: http://evil.example' "$BASE/ideas") == 403 ]] || fail "cross-site idea post allowed"

echo "smoke OK"
