# Deploy notes

## Containers

| CT    | Script               | Limits                                         | Runs                                                      |
| ----- | -------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| `hub` | `create-hub-ct.sh`   | 2 cores, 1 GB RAM                              | Node hub (`hub.service`) behind Caddy on :80/:443         |
| `ai`  | `create-ai-ct.sh`    | 2 cores, 3 GB RAM, no swap, **cpuunits 1**     | `llama-server` :8080 always; `sd-server` :7860 20:00–08:00 |

`cpuunits 1` gives the AI container the lowest CPU weight on the host, so the hub,
CTs 102/103 and everything else win whenever they want the CPU. Its model
processes also run at `nice 19`. Its firewall (nftables, inside the CT) only lets
the hub's IP reach ports 8080 and 7860; SSH stays open on the LAN.

Check the limits on the Proxmox host: `pct config <vmid> | grep -E '^(cores|memory|swap|cpuunits):'`.

## Hub settings (`/etc/hub/hub.env`)

`deploy.sh` creates this file once. Add these by hand, then `systemctl restart hub`.
Anything unset turns the feature off; the hub works without all of them.

| Variable              | Used for                          | Example                                  |
| --------------------- | --------------------------------- | ---------------------------------------- |
| `AI_TEXT_URL`         | Quiz drafts, digest               | `http://ai.local:8080`                   |
| `AI_IMAGE_URL`        | Daily banner                      | `http://ai.local:7860`                   |
| `TEA_STATS_URL`       | Tea break card                    | `https://tea.example/api/stats`       |
| `TEA_STATS_TOKEN`     | Tea break card (bearer token)     | same value as tea-app's `STATS_TOKEN`   |
| `NODE_EXTRA_CA_CERTS` | Trusting tea-app's Caddy CA      | `/etc/hub/tea-ca.crt`               |

The tea app serves HTTPS with Caddy's internal CA. Copy its root certificate to the hub
once (`/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt` on tea-app →
`/etc/hub/tea-ca.crt`, readable by group `hub`) and point `NODE_EXTRA_CA_CERTS` at it.

## Background work

The `hub-jobs` plugin schedules a one-minute EmDash cron task on first boot. Each tick:

- refreshes tea stats every 5 minutes (page views never call tea-app);
- picks the day's comic and downloads its image once (retries every 15 minutes if every source fails);
- queues tonight's quiz drafts after 21:00;
- runs queued AI jobs one at a time (text: 60 s limit; images: 20:00–08:00 only, 20 min limit);
- once a day, deletes banners older than 30 days and finished jobs older than 30 days.

The admin page **Plugins → AI jobs** lists jobs and can queue a test prompt.
Site data the plugin writes lives in `data/staff.db`, comic images in `data/comics/`,
banners in `data/banners/`.

## After deploying the AI container

1. Admin → AI jobs → queue a test prompt; it should turn `done` within a minute.
2. Next morning, check that a banner replaced the plain "Happy <weekday>" strip.
3. After 21:00, check Content → Quiz questions for new unapproved drafts.
