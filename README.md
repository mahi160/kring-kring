# Office Hub

The office noticeboard: an [EmDash](https://docs.emdashcms.com/) site (Astro, Node, SQLite) running in the `hub` LXC at https://hub.office.lan. Staff sign in with a PIN; maintainers have admin accounts (passkey, at https://hub.office.lan/_emdash/admin).

## Pages

| Page | Route | What it shows |
|---|---|---|
| Home | `/` | Date, weather and air quality, announcements, events, celebrations, comic, quiz, news |
| Quiz | `/quiz` | Leaderboards, your points and streaks, past questions |
| People | `/people` | Current staff by team; `/people/me` edits your own card |
| Gallery | `/gallery` | Photo wall; signed-in staff can add photos |
| Ideas | `/ideas` | Staff ideas (named or anonymous) with anonymous upvotes; monthly and all-time leaderboards |
| Handbook | `/handbook` | Office code book, grouped by topic, searchable |
| Sign in / PIN | `/sign-in`, `/pin` | Staff PIN sign-in and PIN change |

## Operator tasks (admin)

- **Content:** announcements, events, people (switch off "Currently works here" for leavers), quiz questions (approve AI drafts), handbook pages, gallery photos (tick "featured" to show one big; delete unwanted staff uploads), ideas (set the stage to planned, done or declined to freeze votes; unpublish to take one down; the poster shows here even for anonymous ideas).
- **Staff PINs:** staff without a PIN choose their own at first sign-in. To fix a wrong claim or a lost PIN, open the person in People; the "Staff PIN" panel generates or resets their PIN.
- **Colour theme:** Plugins → Hub background jobs → Theme. Auto picks a rainbow colour by weekday and switches on date themes (Halloween, Victory Day, Independence Day, Pohela Boishakh, New Year, Harry Potter on 31 July) by themselves; you can also choose Random or any theme (GTA 6, Eid, Winter…). To preview themes on any page, press T (next) or Shift+T (previous); this isn't saved.
- **AI jobs:** Plugins → Hub background jobs → AI jobs (queue status, test prompt).

## Maintainers

Two or three people run the hub. Each has their own admin account, MCP token and GitHub access, so one can be removed without touching the others.

- **Accounts:** Admin → Users → Invite. Maintainers get **Admin**; someone who only edits content gets **Editor**. Invites arrive by email (SMTP, see [infra/README.md](infra/README.md)).
- **Trust the gateway's certificate, once per device.** HTTPS for every `*.office.lan` site uses the gateway CT's own certificate authority (there is no public domain), and passkeys need HTTPS.

  ```bash
  scp root@gateway.lxc:/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt hub-ca.crt
  # macOS
  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain hub-ca.crt
  # Windows (admin prompt)
  certutil -addstore -f ROOT hub-ca.crt
  ```

- **Content by AI (MCP):** Admin → API tokens → create a token for yourself. Point your AI client at `https://hub.office.lan/_emdash/api/mcp` with header `Authorization: Bearer <token>`. Node-based clients that ignore the system certificate store also need `NODE_EXTRA_CA_CERTS=/path/to/hub-ca.crt`.
- **Code by AI:** work in this repo, open a pull request, merge to `main`. It is live within about 5 minutes (see Deploy).
- **SSH** to the container (rarely needed): add the person's public key to `/root/.ssh/authorized_keys` on the hub.

## Changing things

- **Add a colour theme:** a `[data-theme="id"]` block in `src/styles/themes.css` plus an entry in `THEMES` in `src/utils/theme.ts`, then deploy. `pnpm test` checks contrast.
- **Add a news feed:** an entry in `NEWS_SOURCES` in `src/utils/news.ts` (RSS 2.0). A new `tab` name makes a new tab.
- **Schema:** edit `seed/seed.json`; `deploy.sh` adds new collections on the next deploy.

## Development

```bash
pnpm install
pnpm dev          # http://localhost:4321
pnpm test         # unit tests
pnpm typecheck    # astro check
scripts/smoke.sh  # build, run against a throwaway DB, check the main pages
```

## Deploy

Merging to `main` deploys automatically: GitHub builds and tests it, and the hub installs the new build within 5 minutes. If it fails to start, the previous version stays live.

```bash
./deploy.sh       # by hand: build locally, install on root@hub.lxc (first install, or GitHub down)
```

Server setup, environment variables (`AI_TEXT_URL`, `AI_IMAGE_URL`, `TEA_STATS_URL`, …) and the AI container are in [infra/README.md](infra/README.md).
