This is an EmDash site -- a CMS built on Astro with a full admin UI. It is the Office Hub: the office noticeboard served from the `hub` LXC at http://hub.local. See README.md for operator tasks and deploy.

## Commands

```bash
pnpm dev              # Start the Astro dev server
pnpm test             # Unit tests (node --test, strip-only TypeScript: no enums, namespaces or parameter properties)
pnpm typecheck        # astro check
scripts/smoke.sh      # Build, run against a throwaway DB, check the main pages
npx emdash types      # Regenerate TypeScript types from a running site
```

The admin UI is at `http://localhost:4321/_emdash/admin`.

## Key Files

| File                     | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `astro.config.mjs`       | Astro config with `emdash()` integration, database, storage and the hub plugins    |
| `src/live.config.ts`     | EmDash loader registration (boilerplate -- don't modify)                           |
| `seed/seed.json`         | Schema definition + demo content (collections, fields, taxonomies, menus, widgets) |
| `emdash-env.d.ts`        | Generated types for collections (auto-regenerated on dev server start)             |
| `src/layouts/Base.astro` | Base layout: theme, banner header, nav, staff sign-in state                        |
| `src/pages/`             | Astro pages -- all server-rendered                                                 |
| `src/plugins/`           | `staff-pins` (PIN panel on people) and `hub-jobs` (cron tick, AI jobs, Theme page) |
| `src/staff/`             | Hub's own SQLite (`data/staff.db`): PINs, quiz answers, reactions, settings        |
| `src/jobs/`              | Background work: AI queue, quiz drafts, digest, banner; `backgroundTick` per minute |
| `src/styles/`            | `theme.css` (tokens, base styles), `themes.css` (one block per colour theme)       |
| `deploy.sh`, `infra/`    | Deploy to the hub container; server and AI container setup                        |

## Skills

Agent skills are in `.agents/skills/`. Load them when working on specific tasks:

- **building-emdash-site** -- Querying content, rendering Portable Text, schema design, seed files, site features (menus, widgets, search, SEO, comments, bylines). Start here.
- **creating-plugins** -- Building EmDash plugins with hooks, storage, admin UI, API routes, and Portable Text block types.
- **emdash-cli** -- CLI commands for content management, seeding, type generation, and visual editing flow.

## Documentation

The EmDash docs are available as an MCP server at `https://docs.emdashcms.com/mcp`. When you need to verify an API, hook, config option, field type, or pattern, call `search_docs` against the live documentation rather than relying on training-data recall. The docs reflect current behaviour; assumptions may not.

This template ships with `.mcp.json`, `.cursor/mcp.json`, and `.vscode/mcp.json` so Claude Code, Cursor, and VS Code auto-discover the docs server. Other tools (OpenCode, Windsurf, etc.) need a manual one-time setup -- see [docs.emdashcms.com/docs-mcp](https://docs.emdashcms.com/docs-mcp).

## Rules

- All content pages must be server-rendered (`output: "server"`). No `getStaticPaths()` for CMS content.
- Image fields are objects (`{ src, alt }`), not strings. Use `<Image image={...} />` from `"emdash/ui"`.
- `entry.id` is the slug (for URLs). `entry.data.id` is the database ULID (for API calls like `getEntryTerms`).
- When Astro's cache is enabled, pass content-query hints to `Astro.cache.set(cacheHint)`. Use the `WithCacheHint` variants for site settings, menus, taxonomies, and widget areas rendered by cached routes.
- Taxonomy names in queries must match the seed's `"name"` field exactly (e.g., `"category"` not `"categories"`).
- Page views never do AI work or slow network calls; external data is fetched server-side, cached, and warmed by the cron tick.
- Staff POST endpoints check `isCrossSite` (403) and take the staff id from the cookie only.
- Colours come from theme tokens (`--paper`, `--sheet`, `--ink`, `--slate`, `--rule`, `--accent`, `--accent-ink`, `--highlight`, `--note-*`, `--banner-*`); never hard-code a colour a theme should change. Check the dark `halloween` theme.
- Merging to `main` deploys to production automatically (`.github/workflows/deploy.yml` → `infra/hub-update`); `deploy.sh` is the manual path.
- Schema reaches production via `infra/install.sh` (seed in skip mode adds new collections; new fields on an existing collection need an update-mode step like the `people` one).

## Pages

| Page      | Path                     | What it shows                                                        |
| --------- | ------------------------ | -------------------------------------------------------------------- |
| Home      | `/`                      | Date, weather, AQI, announcements, events, celebrations, comic, news |
| Quiz      | `/quiz`                  | Leaderboards, personal points and streaks, past questions            |
| People    | `/people`, `/people/me`  | Active staff by team; edit your own card (signed in)                 |
| Gallery   | `/gallery`               | Bento photo wall + lightbox; staff can upload                        |
| Handbook  | `/handbook`, `/handbook/[slug]` | Office code book by topic, with search                        |
| Page      | `/[slug]`                | Static page content                                                  |
| Staff     | `/sign-in`, `/pin`       | PIN sign-in and PIN change                                           |

## Schema

- `announcements`: `title`, `body` (Portable Text), `pinned`, `expires_at`.
- `events`: `title`, `starts_at`, `ends_at`, `location`, `description`.
- `people`: `name`, `team`, `designation`, `photo`, `birthday_month`, `birthday_day`, `hide_birthday`, `joined_on`, `phone`, `bio`, `active`.
- `quiz_questions`: `question`, `choices`, `correct_choice`, `explanation`, `approved`.
- `handbook`: `title`, `topic` (select; keep in sync with `TOPICS` in `src/utils/handbook.ts`), `order`, `summary`, `content`.
- `gallery`: `photo`, `caption`, `uploaded_by`, `featured` (not routable).
- `posts`, `pages`, taxonomies `category` and `tag`: left over from the starter template; posts have no public pages.

## Visual character

A playful noticeboard: dotted paper, taped cards, sticky notes, a striped banner header, cartoon weather and AQI icons. The colour theme changes daily (rainbow by weekday, date themes, admin override). Display font Big Shoulders, body Atkinson Hyperlegible Next. Use rem font sizes, unitless line-height, and no fixed heights on text containers.
