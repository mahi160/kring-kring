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
| `EMAIL_SMTP_HOST`     | Invites, magic-link sign-in       | `smtp.gmail.com`                         |
| `EMAIL_SMTP_PORT`     | (465 = TLS)                       | `465`                                    |
| `EMAIL_SMTP_USER`     | Google Workspace account          | `hub@yourcompany.com`                    |
| `EMAIL_SMTP_PASS`     | That account's app password       | 16 characters, no spaces                 |
| `EMAIL_SMTP_FROM`     | Sender shown on emails            | `Office Hub <hub@yourcompany.com>`       |

Email goes out through Google; nothing runs on the hub. Use a dedicated Workspace
account with 2-Step Verification on, and create an app password for it
(Google Account → Security → App passwords). Admin → Settings → Email can send a test.

The tea app serves HTTPS with Caddy's internal CA. Copy its root certificate to the hub
once (`/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt` on tea-app →
`/etc/hub/tea-ca.crt`, readable by group `hub`) and point `NODE_EXTRA_CA_CERTS` at it.

## Automatic deploys

Every push to `main` on GitHub runs `.github/workflows/deploy.yml`: tests, typecheck,
smoke check, build, then publishes the bundle as the `hub-build` release. On the hub,
`hub-update.timer` checks that release every 5 minutes and installs anything new with
`install.sh`. GitHub never connects to the office; the hub only makes outbound requests.

If the new version does not start, `install.sh` puts the previous one back and that
build is not tried again (`/opt/hub/failed-build`); the next push to `main` is.
Check with `journalctl -u hub-update -n 50` and `cat /opt/hub/deployed-build`.

One-time setup:

1. On GitHub, create a fine-grained token: this repository only, **Contents: read-only**.
2. On the hub:

   ```bash
   install -m 600 /dev/null /etc/hub/update.env
   nano /etc/hub/update.env   # GITHUB_REPO=owner/office-hub and GITHUB_TOKEN=github_pat_...
   systemctl enable --now hub-update.timer
   ```

   (`hub-update` and its timer are installed by any deploy; on a fresh container run
   `./deploy.sh` once first.)
3. In the repo settings, protect `main`: pull requests required, the `build` check must pass.

When the token expires, the timer logs `GitHub API returned HTTP 401`; put a new one in
`update.env`.

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
