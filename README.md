# Concert Practice

Public K-pop lyric-practice site. Visitors can search published songs, select one lyric line or a contiguous range, and loop that range while an embedded YouTube video plays.

## K-pop Vibrant interface

The public UI uses Vietnamese labels, a purple/lilac/lime visual system, and responsive library/practice screens. Korean lyrics, Vietnamese-friendly pronunciation, romanization, and meanings are retained as provided by the catalog. Selected and currently playing lines have separate text indicators. Controls support keyboard focus, and lyric following respects reduced-motion preferences.

Desktop practice uses two columns and an independently scrolling lyric list. Tall phones keep the player above a scrolling lyric panel; short screens fall back to document scrolling to avoid hiding controls. Decorative song covers use title initials, not invented artist or album metadata.

Design: `docs/superpowers/specs/2026-08-26-kpop-vibrant-ui-design.md`.
Implementation plan: `docs/superpowers/plans/2026-08-26-kpop-vibrant-ui.md`.

### Social preview asset

`public/og.png` was generated once with the built-in image generator, then checked for the exact title and supporting text. It is not loaded in the UI. The prompt requested a landscape K-pop Vibrant card in purple `#6933D4`, lilac `#F7F3FF`, lime `#E3FF78`, and dark purple `#231538`, with bold sans-serif type, a vinyl-circle/concert-ticket motif, and exactly “Concert Practice” / “Your next encore starts here.” No people, artists, logos, or additional lettering.

The current HTML includes text-only social metadata. Once the existing Vercel production origin is verified, set absolute `og:image` and `twitter:image` URLs to that trusted origin plus `/og.png`, and change `twitter:card` to `summary_large_image`. Do not guess a production origin or create a replacement hosting project to resolve it.

## Page routes

- `/` — public song library.
- `/practice/:slug` — practice a published song using its title, for example `/practice/bigbang-loser` or `/practice/into-the-new-world`; supports direct links and refresh.
- Any other path displays a Vietnamese 404 page with a link back to the library. Missing/unpublished songs show a song-specific 404 after the catalog loads; loading, configuration, and network failures remain separate states.

Navigation uses React Router and supports browser Back/Forward. Returning to the library restores heading focus. Practice selections and playback settings are local to the current visit, not saved in the URL.

Slugs are lowercase, strip accent marks (including Vietnamese `đ` → `d`), and replace punctuation/spacing with hyphens. Korean and other non-Latin letters are preserved and URL-encoded. Colliding titles receive a `--<songId>` suffix; titles without letters/numbers use `song--<songId>`. Slugs cannot shadow legacy song IDs. Bare ambiguous slugs return 404 rather than selecting an arbitrary song.

Existing `/practice/:songId` links redirect client-side to the current slug after the catalog loads, replacing the history entry and preserving the query string and hash. No database migration is needed. Because slugs are derived from the current published catalog, renaming a song or adding/removing a slug collision may change its friendly URL; old ID links remain supported, but historical title slugs are not stored.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`. These are public browser values. A Supabase service-role key may exist only as a backend secret (`SUPABASE_SERVER_KEY`), never in browser code, `VITE_*` variables, URLs, logs, or Git.

### Run the local API and UI together

`npm run dev` remains the Vite-only UI server. It does not load server secrets or exercise the import API.

To run the local Vercel API with the UI, create these ignored local files without copying secrets into Git:

- `.secrets/song-import.env` contains `IMPORT_ACCESS_TOKEN`.
- `.secrets/server.env` may contain only server configuration: `APP_ORIGIN`, `GEMINI_API_KEY`, `YOUTUBE_DATA_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVER_KEY`, `CRON_SECRET`, `GEMINI_MODEL`, and `IMPORT_ENABLED`.

Set `APP_ORIGIN=http://127.0.0.1:3000`; leave `IMPORT_ENABLED=false` until the import providers and database are configured. Then run:

```bash
npm run dev:full
```

The wrapper treats both files as plain data, rejects duplicate or conflicting values, preserves the ordinary process environment, and starts `vercel dev` only at `http://127.0.0.1:3000`. It never passes secrets as command-line arguments. Do not use `source` for either file. `.secrets/` is excluded from Git and Vercel uploads.

Check server-only TypeScript separately with:

```bash
npm run check:server
```

The current Vercel development tooling has transitive `npm audit` advisories in its development dependency tree. No broad audit upgrade or downgrade was applied during this local-only foundation task; `IMPORT_ENABLED` remains off by default, and the advisory review remains a release gate.

### Local database tests

Docker is required. `supabase/config.toml` identifies the isolated local project `concert-practice-import-test`, with API port 55321 and PostgreSQL port 55322. It is not linked to production. Start only the database and API on a network whose published ports bind to loopback:

```bash
docker network create -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 concert-practice-import-test-loopback
npx supabase start --network-id concert-practice-import-test-loopback --exclude gotrue,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
npm run test:db
```

If the network already exists, inspect its `host_binding_ipv4` option and use it only if it is `127.0.0.1`. The first start downloads container images; Supabase's interactive start/status output includes local-only credentials, so do not paste it into tickets or logs. This minimal stack does not run Supabase Auth, Studio, Storage, or Edge Runtime. [Supabase local network guidance](https://supabase.com/docs/guides/local-development).

The test runner captures local CLI status without printing keys. It first inspects Docker context metadata locally, requires a Unix socket endpoint, and pins that socket for all CLI calls; SSH/TCP Docker endpoints are refused without connecting to them. It rejects arguments (including `--linked`/`--db-url`), non-loopback URLs, URL query overrides, and unexpected database names/ports. It verifies that the CLI recognizes the existing migration filenames, runs `migration up --local` without resetting the database, executes pgTAP with actual database roles, and checks concurrent counters. A uniquely named scratch database tests the original migration files, safe URL backfill, duplicate rollback, and catalog preservation; only that newly created scratch database is deleted afterwards. Docker/setup failures are test failures, never substituted with mocked permission checks.

Migration `005_import_storage.sql` leaves manual titles, URLs, lyrics, and publication status intact. Invalid legacy video URLs retain a null video ID. Duplicate valid video IDs abort the entire migration for manual review; no songs are deleted or merged. Internal import tables have RLS and no client policies. The existing manual published catalog policies remain unchanged; administrative RPCs are backend-only. Migrations `007_metadata_visibility.sql` and `008_maintenance.sql` enforce AI metadata visibility and retention/heartbeat behavior; keep those controls active even when imports are disabled. Do not apply migrations to a remote database as part of local tests.

### Validate the import feature locally

Run each gate separately so a report can retain its exact exit code:

```bash
npm run test -- --run
npm run test:db
npm run check:server
npm run build
npm run check:client-secrets
```

`check:client-secrets` performs a fresh non-release build with distinctive synthetic server credentials supplied through the child process environment, then scans every file and source map in `dist`. A failure prints only the artifact path and secret type, never the sentinel. This synthetic build must not be uploaded; `npm run deploy` performs its own separate Vercel production build.

The live quality benchmark is deliberately excluded from tests and deployment. Importing its module has no side effects, and the CLI contacts providers only when `--run-live` is the first argument. It requires a private, rights-cleared JSON manifest containing five full-song references prepared by a reviewer who understands the languages, including at least 20 non-overlapping cues across the beginning, middle, and end of every song. The CLI resolves symlinks and rejects a manifest or output that resolves inside this repository.

```bash
npm run benchmark:import -- --run-live --manifest /outside/repo/references.json --output /outside/repo/report.json
```

Load credentials from an approved environment or secret store before running; never put them in CLI arguments, command history, or chat. The command makes at most the ten planned runs, does not call the production API or database, and records timing, actual provider token metadata, finish reasons, CER, cue accuracy, English-copy checks, and review material. A failed validation/provider run is recorded and the remaining independent planned runs continue; quota exhaustion or a timeout stops further provider calls and records the remaining runs as not attempted. The report is published atomically outside the repository and always keeps `featureMayBeEnabled` false. The detailed PASS/FAIL/BLOCKED matrix lives in `docs/validation/youtube-import.md`.

### Authorized production setup and operations

Keep `IMPORT_ENABLED=false` through setup. Before any remote change, the owner must explicitly authorize the target and an operator must verify the existing Vercel account/project/domain and Supabase project reference; never create a substitute project because access is missing. Review remote migration history before an authorized `supabase db push`. Never use `db reset` against a linked or remote project.

Configure server values separately in Vercel Production: `IMPORT_ACCESS_TOKEN`, `APP_ORIGIN`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `YOUTUBE_DATA_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVER_KEY`, `CRON_SECRET`, and `IMPORT_ENABLED`. Only public `VITE_SUPABASE_*` browser values may use `VITE_*`. Confirm Data API is enabled, restrict the YouTube key to the intended API, verify backend RPC privileges and migration history, and verify the actual trusted ingress IP behavior. Confirm Fluid Compute and the 300-second function duration on the existing Vercel plan rather than relying only on `vercel.json`.

Generate access and cron credentials independently with a password manager or secret generator. `IMPORT_ACCESS_TOKEN` must be exactly 32 random bytes encoded as 43-character base64url; never reuse `CRON_SECRET`. To rotate the access token, first set `IMPORT_ENABLED=false`, replace the Production secret, release through the normal verified workflow, and test old-token rejection plus new-token access. Rotation intentionally invalidates all existing eight-hour import cookies. Rotate provider/database credentials independently and revoke the old value only after the replacement release is verified.

The daily maintenance endpoint is `GET /api/internal/maintenance` and accepts only `Authorization: Bearer <CRON_SECRET>`. Vercel Cron is scheduled for 02:00 UTC. Before enabling imports, run one authorized maintenance invocation, verify the database heartbeat, prove that a heartbeat older than 48 hours closes admission, and configure an external alert channel for missed/failed runs. Do not put the bearer value in a URL, command history, ticket, or log.

For an incident or rollback, set `IMPORT_ENABLED=false` and release that configuration first. Keep maintenance, retention cleanup, metadata visibility/RLS, and existing AI/manual songs intact; do not delete prior imports or roll back schema to stop new admissions. Revoke/rotate a suspected credential, inspect provider/Vercel/Supabase audit data without copying secrets, and re-enable only after the failed gate has fresh evidence.

## Existing Supabase project and migrations

Use the existing Supabase project; do not create a replacement project for this application. With explicit owner authorization, first verify the project reference and remote migration history, then apply migrations `001` through `008` in order through the normal migration workflow. Do not run only `001` manually in the SQL Editor, and do not use `supabase db reset` against a linked or remote project.

Confirm the applied migration history and effective backend/public privileges before enabling imports. Existing manual songs and lyrics stay intact; use the existing catalog workflow for new manual songs, keep unfinished songs as `draft`, and publish only when ready. The public site reads only eligible published songs and lyrics.

## Check the app

```bash
npm run test -- --run
npm run build
```

Automated checks currently pass. The full development-dependency `npm audit` finding remains a separate release risk recorded in the validation matrix; it has not been masked by an automatic dependency upgrade. Layout breakpoints and contrast were reviewed in code; browser visual QA and real YouTube playback testing have not been performed for this redesign.

## Deploy to Vercel

Vercel is this project's default deployment provider. An unqualified request to "deploy" means Vercel; the repository's `AGENTS.md` records this preference for future Codex sessions.

Run once to log in and link the correct account and **existing** Vercel project (do not create a new project):

```bash
npm run deploy:setup
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in that project's Production environment settings. These public browser values are embedded at build time; never use a service-role key.

For each production release:

```bash
npm run deploy
```

This runs the server typecheck and unit/component suite, pulls production settings, builds locally with Vercel, then uploads the separately built prebuilt output to production. It stops if any step fails. The real local database report, synthetic secret scan, dependency-risk decision, and approved live-quality report are release prerequisites recorded outside this automatic command; deployment never spends provider quota ten times. Requires Vercel access and internet. `.vercel/` stays ignored by Git. See [Vercel prebuilt deployments](https://vercel.com/docs/cli/deploy#prebuilt).

`npm run build` only builds locally. `vercel.json` sets the Vite build/output and SPA fallback for direct links and refresh; React Router renders the 404 screen inside an HTTP 200 page shell. After a release, check the returned URL and a direct `/practice/:slug` link.

YouTube is embedded directly; this site does not download, proxy, or store audio/video.
