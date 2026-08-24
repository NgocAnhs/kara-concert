# Concert Practice

Public K-pop lyric-practice site. Visitors can search published songs, select one lyric line or a contiguous range, and loop that range while an embedded YouTube video plays.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`. These are public browser values. Never add a Supabase service-role key to this project.

## Set up the catalog

1. Create a Supabase project.
2. Run `supabase/migrations/001_create_catalog.sql` in the Supabase SQL Editor.
3. In Supabase Dashboard, add a song and its ordered `lyric_lines`.
4. Keep unfinished songs as `draft`; set `status` to `published` when visitors should see them.

The public site has no create, edit, import, export, or sign-in function. Row Level Security allows anonymous visitors to read only published songs and their lyrics; all changes are made through the Supabase Dashboard.

## Check the app

```bash
npm run test -- --run
npm run build
```

## Deploy

Deploy the repository as a static Vite site to Vercel or Netlify. Use `npm run build` as the build command and `dist` as the output directory. Configure the two `VITE_SUPABASE_*` values in the hosting provider's environment settings.

YouTube is embedded directly; this site does not download, proxy, or store audio/video.
