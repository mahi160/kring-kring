#!/usr/bin/env bash
# Run ONCE as root on the Proxmox host (pve). Creates the `gateway` LXC, which
# gives every container a name and HTTPS:
#   dnsmasq  office.lan, *.office.lan -> this CT; <ct>.lxc -> that CT's IP
#   Caddy    https://office.lan -> Proxmox UI
#            https://<name>.office.lan -> http://<name>.lxc:80 (internal CA)
# It also installs lxc-dns-sync on this host: a one-minute timer that pushes
# "<ip> <hostname>.lxc" for every running CT to the gateway's dnsmasq.
# The MikroTik forwards office.lan and lxc to this CT (infra/README.md).
#   bash create-gateway-ct.sh
set -euo pipefail

HOSTNAME=gateway
DOMAIN=office.lan
TEMPLATE=local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst
GH_KEY_USERS=(mahi160)
ROUTER=$(ip route show default | awk '{print $3; exit}')
HOST_IP=$(ip -o -f inet addr show dev vmbr0 | awk '{print $4; exit}' | cut -d/ -f1)

if pct list | awk 'NR>1 {print $NF}' | grep -qx "$HOSTNAME"; then
	echo "A container named '$HOSTNAME' already exists; refusing to create another." >&2
	exit 1
fi

VMID=$(pvesh get /cluster/nextid)
echo "==> Using VMID $VMID"
KEYS=$(mktemp)
TMP=$(mktemp -d)
trap 'rm -rf "$KEYS" "$TMP"' EXIT
for u in "${GH_KEY_USERS[@]}"; do
	echo "==> Fetching SSH keys of GitHub user $u"
	curl -fsSL --max-time 20 "https://github.com/$u.keys" >>"$KEYS"
done

echo "==> Creating container"
pct create "$VMID" "$TEMPLATE" \
	--hostname "$HOSTNAME" \
	--unprivileged 1 \
	--features nesting=1 \
	--cores 1 \
	--memory 256 \
	--swap 256 \
	--rootfs local-lvm:4 \
	--net0 name=eth0,bridge=vmbr0,ip=dhcp \
	--nameserver "$ROUTER" \
	--onboot 1 \
	--startup order=1 \
	--timezone Asia/Dhaka \
	--ssh-public-keys "$KEYS" \
	--description "DNS (*.$DOMAIN, *.lxc) and HTTPS proxy - https://$DOMAIN" \
	--start 1

echo "==> Waiting for network"
for _ in $(seq 1 30); do
	pct exec "$VMID" -- getent hosts deb.debian.org >/dev/null 2>&1 && break
	sleep 2
done
IP=$(pct exec "$VMID" -- ip -o -f inet addr show dev eth0 | awk '{print $4; exit}' | cut -d/ -f1)
MAC=$(pct config "$VMID" | sed -n 's/^net0:.*hwaddr=\([^,]*\).*/\1/p')

echo "==> Installing dnsmasq and Caddy"
# Written before installing dnsmasq so its first start already uses it.
cat >"$TMP/dnsmasq.conf" <<EOF
# The MikroTik forwards $DOMAIN and lxc here; everything else goes back to it.
# bind-dynamic: leave 127.0.0.53 to systemd-resolved, pick up eth0's DHCP address late.
bind-dynamic
interface=eth0
interface=lo
domain-needed
bogus-priv
no-resolv
no-hosts
server=$ROUTER
address=/$DOMAIN/$IP
local=/lxc/
# lxc-dns-sync on the Proxmox host writes /etc/dnsmasq.hosts/lxc; changes are read automatically.
hostsdir=/etc/dnsmasq.hosts
EOF
cat >"$TMP/Caddyfile" <<EOF
{
	skip_install_trust
}

# Root certificate over plain HTTP, so a device can fetch it before it trusts it.
http://$DOMAIN {
	handle /ca.crt {
		root * /var/lib/caddy/.local/share/caddy/pki/authorities/local
		rewrite * /root.crt
		header Content-Type application/x-x509-ca-cert
		file_server
	}
	handle {
		redir https://{host}{uri}
	}
}

$DOMAIN {
	tls internal
	reverse_proxy https://$HOST_IP:8006 {
		transport http {
			tls_insecure_skip_verify
		}
	}
}

# hub.$DOMAIN -> hub.lxc:80. Every app serves plain HTTP on port 80 inside its CT.
*.$DOMAIN {
	tls internal
	reverse_proxy {labels.2}.lxc:80
}
EOF
pct exec "$VMID" -- install -d /etc/dnsmasq.d /etc/dnsmasq.hosts /etc/caddy
pct exec "$VMID" -- touch /etc/dnsmasq.hosts/lxc
pct push "$VMID" "$TMP/dnsmasq.conf" /etc/dnsmasq.d/gateway.conf --perms 644
pct push "$VMID" "$TMP/Caddyfile" /etc/caddy/Caddyfile --perms 644
pct exec "$VMID" -- bash -euo pipefail -c '
	export DEBIAN_FRONTEND=noninteractive
	apt-get update
	apt-get -y upgrade
	apt-get install -y -o Dpkg::Options::=--force-confold dnsmasq caddy
	systemctl enable dnsmasq caddy
	systemctl restart dnsmasq caddy
'

echo "==> Installing lxc-dns-sync on this host"
echo "GW_VMID=$VMID" >/etc/default/lxc-dns-sync
cat >/usr/local/sbin/lxc-dns-sync <<'EOF'
#!/usr/bin/env bash
# Push "<ip> <hostname>.lxc" for this host and every running CT to the gateway's dnsmasq.
# ponytail: CTs only; VMs need the QEMU guest agent to report their IP.
set -euo pipefail
. /etc/default/lxc-dns-sync
new=$(mktemp)
trap 'rm -f "$new"' EXIT
first_ipv4() { awk '{print $4; exit}' | cut -d/ -f1; }

echo "$(ip -o -f inet addr show dev vmbr0 | first_ipv4) $(hostname).lxc" >"$new"
for id in $(pct list | awk 'NR>1 && $2=="running" {print $1}'); do
	name=$(pct config "$id" | awk '/^hostname:/ {print $2}')
	ip=$(pct exec "$id" -- ip -o -f inet addr show dev eth0 2>/dev/null | first_ipv4 || true)
	if [[ -n $name && -n $ip ]]; then
		echo "$ip $name.lxc" >>"$new"
	fi
done

if ! pct exec "$GW_VMID" -- cat /etc/dnsmasq.hosts/lxc | cmp -s - "$new"; then
	pct push "$GW_VMID" "$new" /etc/dnsmasq.hosts/lxc --perms 644
fi
EOF
chmod 755 /usr/local/sbin/lxc-dns-sync
cat >/etc/systemd/system/lxc-dns-sync.service <<'EOF'
[Unit]
Description=Push CT names (<hostname>.lxc) to the gateway CT's DNS

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/lxc-dns-sync
EOF
cat >/etc/systemd/system/lxc-dns-sync.timer <<'EOF'
[Unit]
Description=Push CT names to the gateway CT's DNS every minute

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
/usr/local/sbin/lxc-dns-sync
systemctl enable --now lxc-dns-sync.timer

# Caddy itself must resolve <name>.lxc, so the gateway asks its own dnsmasq.
pct set "$VMID" --nameserver 127.0.0.1 --searchdomain lxc
pct reboot "$VMID"
sleep 5

echo "==> Checking"
pct exec "$VMID" -- getent hosts "test.$DOMAIN" "$(hostname).lxc"

cat <<EOF

Created CT $VMID ($HOSTNAME): IP $IP, MAC $MAC.
Next, on the MikroTik (infra/README.md, "Names and HTTPS"):
  /ip dhcp-server lease make-static [find mac-address=$MAC]
  /ip dns static add name=$DOMAIN type=FWD forward-to=$IP match-subdomain=yes
  /ip dns static add name=lxc type=FWD forward-to=$IP match-subdomain=yes
Root certificate to trust on your devices: http://$DOMAIN/ca.crt
EOF
