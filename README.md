# Office Hub

The office noticeboard: an [EmDash](https://docs.emdashcms.com/) site (Astro, Node, SQLite) running in the `hub` LXC at http://hub.local. Staff browse over plain HTTP and sign in with a PIN; only the operator has an admin account (passkey, at https://hub.local/_emdash/admin).

## Pages

| Page | Route | What it shows |
|---|---|---|
| Home | `/` | Date, weather and air quality, announcements, events, celebrations, comic, quiz, news |
| Quiz | `/quiz` | Leaderboards, your points and streaks, past questions |
| People | `/people` | Current staff by team; `/people/me` edits your own card |
| Gallery | `/gallery` | Photo wall; signed-in staff can add photos |
| Handbook | `/handbook` | Office code book, grouped by topic, searchable |
| Sign in / PIN | `/sign-in`, `/pin` | Staff PIN sign-in and PIN change |

## Operator tasks (admin)

- **Content:** announcements, events, people (switch off "Currently works here" for leavers), quiz questions (approve AI drafts), handbook pages, gallery photos (tick "featured" to show one big; delete unwanted staff uploads).
- **Staff PINs:** open a person in People; the "Staff PIN" panel generates or resets their PIN.
- **Colour theme:** Plugins → Hub background jobs → Theme. Auto picks a rainbow colour by weekday and switches on date themes (Halloween, Victory Day, Independence Day, Pohela Boishakh, New Year) by themselves; you can also choose Random or any theme (GTA 6, Eid, Winter…).
- **AI jobs:** Plugins → Hub background jobs → AI jobs (queue status, test prompt).

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

```bash
./deploy.sh       # builds locally, copies to root@hub.local, restarts the service
```

Server setup, environment variables (`AI_TEXT_URL`, `AI_IMAGE_URL`, `TEA_STATS_URL`, …) and the AI container are in [infra/README.md](infra/README.md).
