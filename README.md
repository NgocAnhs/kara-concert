# Concert Practice

Public K-pop lyric-practice site. Visitors can search published songs, select one lyric line or a contiguous range, and loop that range while an embedded YouTube video plays.

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

## Deploy

Deploy the repository as a static Vite site to Vercel or Netlify. Use `npm run build` as the build command and `dist` as the output directory. Configure the two `VITE_SUPABASE_*` values in the hosting provider's environment settings.

YouTube is embedded directly; this site does not download, proxy, or store audio/video.
