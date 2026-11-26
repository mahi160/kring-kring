#!/usr/bin/env bash
# Run ONCE as root on the Proxmox host (pve). Creates the `hub` LXC and
# installs its base packages. Everything after this is done by deploy.sh.
#   bash create-hub-ct.sh
set -euo pipefail

HOSTNAME=hub
TEMPLATE=local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst
GH_KEY_USERS=(mahi160 maintainer2)

if pct list | awk 'NR>1 {print $NF}' | grep -qx "$HOSTNAME"; then
	echo "A container named '$HOSTNAME' already exists; refusing to create another." >&2
	exit 1
fi

VMID=$(pvesh get /cluster/nextid)
echo "==> Using VMID $VMID"
KEYS=$(mktemp)
trap 'rm -f "$KEYS"' EXIT
for u in "${GH_KEY_USERS[@]}"; do
	echo "==> Fetching SSH keys of GitHub user $u"
	curl -fsSL --max-time 20 "https://github.com/$u.keys" >>"$KEYS"
done

echo "==> Creating container"
pct create "$VMID" "$TEMPLATE" \
	--hostname "$HOSTNAME" \
	--unprivileged 1 \
	--features nesting=1 \
	--cores 2 \
	--memory 1024 \
	--swap 512 \
	--rootfs local-lvm:8 \
	--net0 name=eth0,bridge=vmbr0,ip=dhcp \
	--onboot 1 \
	--timezone Asia/Dhaka \
	--ssh-public-keys "$KEYS" \
	--description "Office hub (EmDash) - https://hub.office.lan" \
	--start 1

echo "==> Waiting for network"
# Wait for DHCP before using the network.
for _ in $(seq 1 30); do
	pct exec "$VMID" -- getent hosts deb.nodesource.com >/dev/null 2>&1 && break
	sleep 2
done

echo "==> Installing packages (a few minutes)"
pct exec "$VMID" -- bash -euo pipefail -c '
	export DEBIAN_FRONTEND=noninteractive
	apt-get update
	apt-get -y upgrade
	apt-get install -y avahi-daemon rsync curl ca-certificates
	curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
	apt-get install -y nodejs
	npm install -g pnpm@11
	useradd --system --home-dir /opt/hub --shell /usr/sbin/nologin hub
	install -d -o hub -g hub /opt/hub /opt/hub/data
	systemctl enable --now avahi-daemon
'

echo "Created CT $VMID ($HOSTNAME). Node: $(pct exec "$VMID" -- node --version)"
echo "Check from another machine (after a minute): ping $HOSTNAME.lxc"
