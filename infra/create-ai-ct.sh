#!/usr/bin/env bash
# Run ONCE as root on the Proxmox host. Creates the `ai` LXC that runs the
# hub's local models, capped so it can never starve the other containers:
#   2 cores, 3 GB RAM, cpuunits 1 (lowest CPU weight; everything else wins).
#   bash create-ai-ct.sh      (reads .env beside it or in its parent; see .env.example)
# Takes 20-40 minutes: it compiles llama.cpp and stable-diffusion.cpp and downloads ~3 GB of models.
set -euo pipefail

for env in "$(dirname "$0")/.env" "$(dirname "$0")/../.env"; do
	if [[ -f $env ]]; then source "$env"; break; fi
done
HOSTNAME=ai
HUB_IP=${HUB_IP:?set HUB_IP in .env (see .env.example)}
TEMPLATE=local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst
read -ra GH_KEY_USERS <<<"${SSH_KEY_GITHUB_USERS:?set SSH_KEY_GITHUB_USERS in .env (see .env.example)}"
# Text: Qwen3 1.7B, 4-bit, ~1.1 GB.
TEXT_MODEL_URL=https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf
# Image: SD-Turbo (4 steps, CFG 1), 8-bit, ~2 GB.
IMAGE_MODEL_URL=https://huggingface.co/Green-Sky/SD-Turbo-GGUF/resolve/main/sd_turbo-f16-q8_0.gguf

if pct list | awk 'NR>1 {print $NF}' | grep -qx "$HOSTNAME"; then
	echo "A container named '$HOSTNAME' already exists; refusing to create another." >&2
	exit 1
fi

VMID=$(pvesh get /cluster/nextid)
echo "==> Using VMID $VMID"
KEYS=$(mktemp)
trap 'rm -f "$KEYS"' EXIT
for u in "${GH_KEY_USERS[@]}"; do
	curl -fsSL --max-time 20 "https://github.com/$u.keys" >>"$KEYS"
done

echo "==> Creating container"
pct create "$VMID" "$TEMPLATE" \
	--hostname "$HOSTNAME" \
	--unprivileged 1 \
	--features nesting=1 \
	--cores 2 \
	--memory 3072 \
	--swap 0 \
	--cpuunits 1 \
	--rootfs local-lvm:16 \
	--net0 name=eth0,bridge=vmbr0,ip=dhcp \
	--onboot 1 \
	--timezone Asia/Dhaka \
	--ssh-public-keys "$KEYS" \
	--description "Office hub AI (llama-server :8080, sd-server :7860 at night). Only the hub may connect." \
	--start 1

for _ in $(seq 1 30); do
	pct exec "$VMID" -- getent hosts github.com >/dev/null 2>&1 && break
	sleep 2
done

echo "==> Installing, building and downloading (long)"
pct exec "$VMID" -- env HUB_IP="$HUB_IP" TEXT_MODEL_URL="$TEXT_MODEL_URL" IMAGE_MODEL_URL="$IMAGE_MODEL_URL" \
	bash -euo pipefail -c '
	export DEBIAN_FRONTEND=noninteractive
	apt-get update
	apt-get -y upgrade
	apt-get install -y avahi-daemon build-essential cmake git curl ca-certificates nftables
	useradd --system --home-dir /opt/ai --shell /usr/sbin/nologin ai
	install -d -o ai -g ai /opt/ai /opt/ai/models

	cd /opt/ai
	git clone --depth 1 https://github.com/ggml-org/llama.cpp
	cmake -S llama.cpp -B llama.cpp/build -DCMAKE_BUILD_TYPE=Release
	cmake --build llama.cpp/build --target llama-server -j 2
	git clone --depth 1 --recursive https://github.com/leejet/stable-diffusion.cpp
	cmake -S stable-diffusion.cpp -B stable-diffusion.cpp/build -DCMAKE_BUILD_TYPE=Release
	cmake --build stable-diffusion.cpp/build --target sd-server -j 2

	curl -fL --retry 3 -o models/text.gguf "$TEXT_MODEL_URL"
	curl -fL --retry 3 -o models/image.gguf "$IMAGE_MODEL_URL"
	chown -R ai:ai /opt/ai/models

	# Text model: always on. Nice 19 on top of the container'"'"'s cpuunits.
	cat >/etc/systemd/system/llama.service <<EOF
[Unit]
Description=llama-server (hub text model)
After=network-online.target
[Service]
User=ai
Nice=19
ExecStart=/opt/ai/llama.cpp/build/bin/llama-server -m /opt/ai/models/text.gguf --host 0.0.0.0 --port 8080 -t 2 -c 4096 -np 1 --jinja --reasoning-budget 0
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

	# Image model: only 20:00-08:00, the hub'"'"'s image window, so it never holds RAM by day.
	cat >/etc/systemd/system/sd.service <<EOF
[Unit]
Description=sd-server (hub banner model, night only)
After=network-online.target
[Service]
User=ai
Nice=19
ExecStart=/opt/ai/stable-diffusion.cpp/build/bin/sd-server -m /opt/ai/models/image.gguf --listen-ip 0.0.0.0 --listen-port 7860 -t 2 --steps 4 --cfg-scale 1.0
Restart=on-failure
RestartSec=30
EOF
	cat >/etc/systemd/system/sd-start.timer <<EOF
[Timer]
OnCalendar=*-*-* 20:00:00
Persistent=true
Unit=sd.service
[Install]
WantedBy=timers.target
EOF
	cat >/etc/systemd/system/sd-stop.service <<EOF
[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl stop sd.service
EOF
	cat >/etc/systemd/system/sd-stop.timer <<EOF
[Timer]
OnCalendar=*-*-* 08:00:00
Unit=sd-stop.service
[Install]
WantedBy=timers.target
EOF

	# Only the hub may reach the model ports; SSH stays open on the LAN.
	cat >/etc/nftables.conf <<EOF
#!/usr/sbin/nft -f
flush ruleset
table inet filter {
	chain input {
		type filter hook input priority 0; policy drop;
		iif lo accept
		ct state established,related accept
		icmp type echo-request accept
		icmpv6 type { echo-request, nd-neighbor-solicit, nd-neighbor-advert, nd-router-advert } accept
		tcp dport 22 accept
		udp dport 5353 accept
		ip saddr $HUB_IP tcp dport { 8080, 7860 } accept
	}
}
EOF
	systemctl daemon-reload
	systemctl enable --now nftables avahi-daemon llama.service sd-start.timer sd-stop.timer
'

echo "==> Container limits now:"
pct config "$VMID" | grep -E "^(cores|memory|swap|cpuunits):"
echo "Created CT $VMID ($HOSTNAME)."
echo "Next: on the hub, add to /etc/hub/hub.env and restart it (systemctl restart hub):"
echo "  AI_TEXT_URL=http://$HOSTNAME.local:8080"
echo "  AI_IMAGE_URL=http://$HOSTNAME.local:7860"
