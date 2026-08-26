# Concert Practice

Public K-pop lyric-practice site. Visitors can search published songs, select one lyric line or a contiguous range, and loop that range while an embedded YouTube video plays.

## K-pop Vibrant interface

The public UI uses Vietnamese labels, a purple/lilac/lime visual system, and responsive library/practice screens. Korean lyrics, Vietnamese-friendly pronunciation, romanization, and meanings are retained as provided by the catalog. Selected and currently playing lines have separate text indicators. Controls support keyboard focus, and lyric following respects reduced-motion preferences.

Desktop practice uses two columns and an independently scrolling lyric list. Tall phones keep the player above a scrolling lyric panel; short screens fall back to document scrolling to avoid hiding controls. Decorative song covers use title initials, not invented artist or album metadata.

Design: `docs/superpowers/specs/2026-08-26-kpop-vibrant-ui-design.md`.
Implementation plan: `docs/superpowers/plans/2026-08-26-kpop-vibrant-ui.md`.

### Social preview asset

`public/og.png` was generated once with the built-in image generator, then checked for the exact title and supporting text. It is not loaded in the UI. The prompt requested a landscape K-pop Vibrant card in purple `#6933D4`, lilac `#F7F3FF`, lime `#E3FF78`, and dark purple `#231538`, with bold sans-serif type, a vinyl-circle/concert-ticket motif, and exactly “Concert Practice” / “Your next encore starts here.” No people, artists, logos, or additional lettering.

The existing Sites project could not be resolved (`project_not_found`) during this update. Once the correct existing project is accessible, set absolute `og:image` and `twitter:image` URLs to its trusted origin plus `/og.png`, and change `twitter:card` to `summary_large_image`. Do not guess a production origin or replace the stored project ID by matching a title. The current HTML intentionally includes text-only social metadata until that publication step is possible.

## Page routes

- `/` — public song library.
- `/practice/:songId` — practice a published song by ID; supports direct links and refresh.
- Any other path displays a Vietnamese 404 page with a link back to the library. Missing/unpublished songs show a song-specific 404 after the catalog loads; loading, configuration, and network failures remain separate states.

Navigation uses React Router and supports browser Back/Forward. Returning to the library restores heading focus. Practice selections and playback settings are local to the current visit, not saved in the URL.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`. These are public browser values. Never add a Supabase service-role key to this project.

## Create the Supabase project

1. Go to Supabase and create a new project.
2. Wait for the database to finish provisioning.
3. Open `Project Settings` -> `Data API`.
4. Copy these two public browser values:
   - `Project URL`
   - `anon public` key
5. Put them into `.env.local`:

```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## Create the catalog schema

1. Open the Supabase SQL Editor.
2. Run `supabase/migrations/001_create_catalog.sql`.
3. Confirm that the `songs` and `lyric_lines` tables were created.

## Add one starter song

1. In the same SQL Editor, run `supabase/seeds/001_sample_song.sql`.
2. This inserts one published sample song plus four timed lyric lines.
3. Start the app with `npm run dev` and open it in the browser.
4. You should see `Into the New World` in the public library immediately.

## Add your real concert songs

1. Open `Table Editor` in Supabase.
2. Add rows to `songs` and `lyric_lines`.
3. Keep unfinished songs as `draft`.
4. Switch `status` to `published` only when the song is ready to appear in the public app.

The public site has no create, edit, import, export, or sign-in function. Row Level Security allows anonymous visitors to read only published songs and their lyrics; all changes are made through the Supabase Dashboard.

## Check the app

```bash
npm run test -- --run
npm run build
```

Automated tests cover catalog loading/error/empty states, searching, navigation focus, adjacent selections, playback mode/rate, preserved lyric fields, selected/playing status, and reduced-motion/container scrolling. Layout breakpoints and contrast were reviewed in code; browser visual QA and real YouTube playback testing have not been performed for this redesign. The build may report the existing large-chunk warning; it does not prevent static output.

## Deploy

Deploy the repository as a static Vite site to Vercel or Netlify. Use `npm run build` as the build command and `dist` as the output directory. Configure the two `VITE_SUPABASE_*` values in the hosting provider's environment settings.

`vercel.json` and `public/_redirects` provide the SPA fallback for Vercel and Netlify. The Sites asset handler also falls back to `index.html` for missing HTML page requests while preserving missing-asset and non-navigation responses. These fallbacks let React Router handle direct links and display its 404 screen; the static page shell itself has HTTP status 200. Other hosts must configure an equivalent fallback.

YouTube is embedded directly; this site does not download, proxy, or store audio/video.
