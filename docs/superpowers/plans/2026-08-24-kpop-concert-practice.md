# K-pop Concert Practice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, read-only K-pop lyric-practice site backed by Supabase, with embedded YouTube playback, seek-by-line, and selected-range looping.

**Architecture:** A React single-page app fetches only published songs and lyric lines through Supabase's public anonymous key. Supabase Postgres stores the curated catalog and RLS limits anonymous clients to reading published songs; all data management remains in Supabase Dashboard. Pure client-side range helpers drive the YouTube player adapter.

**Tech Stack:** React, TypeScript, Vite, Supabase Postgres and JavaScript client, `react-youtube`, Zod, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-24-kpop-concert-practice-design.md`

## Global Constraints

- Visitors do not sign in and cannot create, edit, import, or export song data.
- Only songs with `status = 'published'` may be shown to the public.
- Database writes use Supabase Dashboard; no service-role key is bundled in the app.
- YouTube is embedded only: do not download, proxy, or store audio/video.
- A practice range consists of one line or adjacent valid timestamped lines.
- The workspace must be initialized as Git before commits are made.

---

## File Structure

```text
supabase/migrations/001_create_catalog.sql  Tables, constraints, indexes, RLS policies
src/lib/supabase.ts                         Browser Supabase client
src/domain/song.ts                          Public data types and Zod mapping
src/domain/practiceRange.ts                 Range and loop rules
src/repositories/songRepository.ts          Published catalog query
src/components/SongLibrary.tsx              Loading, error, empty, search, song cards
src/components/PracticePanel.tsx            Selected lyrics and controls
src/components/YouTubePracticePlayer.tsx    Embed and player loop adapter
src/app/App.tsx                             Library/practice route state
tests/domain/*.test.ts                      Mapping and practice logic
tests/repositories/*.test.ts                Query data transformation
tests/components/*.test.tsx                 Visitor-facing UI behavior
```

### Task 1: Scaffold the app and test environment

**Files:** Create `package.json`, `vite.config.ts`, `src/main.tsx`, `src/app/App.tsx`, `src/test/setup.ts`, `src/app/App.test.tsx`, `.gitignore`.

**Produces:** Root `App` component and working test/build commands.

- [ ] **Step 1: Initialize Git and Vite**

```bash
git init
npm create vite@latest . -- --template react-ts
npm install
npm install @supabase/supabase-js react-youtube zod
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2: Write a failing public-library test**

```tsx
test('shows the public practice catalog', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /concert practice/i })).toBeInTheDocument();
});
```

- [ ] **Step 3: Run the failing test**

Run: `npm run test -- --run src/app/App.test.tsx`

Expected: FAIL because test configuration or `App` is absent.

- [ ] **Step 4: Add Vitest configuration and root shell**

Set Vitest `environment` to `jsdom` and its `setupFiles` to `src/test/setup.ts`, which imports `@testing-library/jest-dom`. Export:

```tsx
export function App() {
  return <main><h1>Concert Practice</h1><section aria-label="Song library" /></main>;
}
```

- [ ] **Step 5: Verify and commit**

Run: `npm run test -- --run src/app/App.test.tsx && npm run build`

```bash
git add . && git commit -m "chore: scaffold concert practice app"
```

### Task 2: Provision the curated Supabase catalog securely

**Files:** Create `supabase/migrations/001_create_catalog.sql`, `.env.example`.

**Produces:** `songs` and `lyric_lines` tables with public read-only RLS and a documented client-only environment configuration.

- [ ] **Step 1: Write a migration acceptance checklist before SQL**

Record these checks as SQL comments at the top of the migration:

```sql
-- Anonymous SELECT returns published songs only.
-- Anonymous SELECT cannot insert, update, or delete either table.
-- Lyrics are readable only when their parent song is published.
-- start_seconds is non-negative and end_seconds is greater than start_seconds.
```

- [ ] **Step 2: Create the schema and constraints**

Create `songs` with `id uuid primary key default gen_random_uuid()`, `title text not null`, `youtube_url text not null`, `status text not null default 'draft' check (status in ('draft','published'))`, and timestamps. Create `lyric_lines` with an ID, `song_id` foreign key to `songs` with `on delete cascade`, Korean lyrics, optional romanization/meaning, non-negative `display_order`, `start_seconds numeric`, and `end_seconds numeric check (end_seconds > start_seconds)`. Add unique `(song_id, display_order)`.

- [ ] **Step 3: Add RLS policies**

Enable RLS on both tables. Add an anonymous `SELECT` policy on `songs` using `status = 'published'`. Add an anonymous `SELECT` policy on `lyric_lines` using an `exists` subquery for a parent `songs` row with `status = 'published'`. Do not create any anonymous insert/update/delete policy.

- [ ] **Step 4: Document public browser configuration**

Create `.env.example`:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-anon-key
```

Add a comment stating that the service-role key must never be placed in a Vite environment file.

- [ ] **Step 5: Apply and verify in Supabase**

Create a Supabase project, run the migration in SQL Editor, insert one draft and one published song plus lines through Dashboard, then query through the anonymous client. Confirm the draft and its lines are absent and an anonymous `insert` is rejected.

- [ ] **Step 6: Commit database setup**

```bash
git add supabase/migrations/001_create_catalog.sql .env.example
git commit -m "feat: add public read-only song catalog"
```

### Task 3: Define public song mapping and fetch published catalog

**Files:** Create `src/lib/supabase.ts`, `src/domain/song.ts`, `src/repositories/songRepository.ts`, `tests/domain/song.test.ts`, `tests/repositories/songRepository.test.ts`.

**Produces:** `LyricLine`, `Song`, `parsePublishedSongs(value)`, and `listPublishedSongs(client)`.

- [ ] **Step 1: Write failing validation and mapping tests**

```ts
test('maps valid sorted line data into a song', () => {
  expect(parsePublishedSongs([{ id: 's1', title: 'Song', youtube_url: 'https://youtu.be/abc', lyric_lines: [{ id: 'l2', korean: '둘', display_order: 1, start_seconds: 2, end_seconds: 3 }]}])[0].lines[0].korean).toBe('둘');
});
test('rejects a malformed public line', () => {
  expect(() => parsePublishedSongs([{ id: 's1', title: 'Song', youtube_url: 'x', lyric_lines: [{ id: 'l1', korean: '', display_order: 0, start_seconds: 2, end_seconds: 1 }]}])).toThrow();
});
```

- [ ] **Step 2: Run tests; expect failure**

Run: `npm run test -- --run tests/domain/song.test.ts tests/repositories/songRepository.test.ts`

- [ ] **Step 3: Implement client, schema, and repository**

Create a single Supabase browser client using `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. In the repository call `from('songs').select('id,title,youtube_url,lyric_lines(id,korean,romanization,meaning,display_order,start_seconds,end_seconds)')`, order songs by title and lines by display order, throw a descriptive `Error` on query failure, and map/validate results through Zod. Do not query drafts in client code; RLS is the enforcement layer.

- [ ] **Step 4: Verify and commit**

Run: `npm run test -- --run tests/domain/song.test.ts tests/repositories/songRepository.test.ts`

```bash
git add src/lib src/domain src/repositories tests && git commit -m "feat: load published songs from Supabase"
```

### Task 4: Implement practice range and looping rules

**Files:** Create `src/domain/practiceRange.ts`, `tests/domain/practiceRange.test.ts`.

**Consumes:** `LyricLine` from `src/domain/song.ts`.

**Produces:** `PracticeRange`, `createPracticeRange(lines, selectedIds)`, `shouldLoop(currentSeconds, range)`.

- [ ] **Step 1: Write failing tests**

```ts
const lines = [
  { id: 'a', korean: 'a', displayOrder: 0, startSeconds: 1, endSeconds: 2 },
  { id: 'b', korean: 'b', displayOrder: 1, startSeconds: 2, endSeconds: 3 },
  { id: 'c', korean: 'c', displayOrder: 2, startSeconds: 3, endSeconds: 4 },
];
expect(createPracticeRange(lines, ['a', 'b'])).toEqual({ startSeconds: 1, endSeconds: 3, lineIds: ['a', 'b'] });
expect(createPracticeRange(lines, ['a', 'c'])).toBeNull();
expect(shouldLoop(3, { startSeconds: 1, endSeconds: 3, lineIds: ['a', 'b'] })).toBe(true);
```

- [ ] **Step 2: Run tests; expect failure**

Run: `npm run test -- --run tests/domain/practiceRange.test.ts`

- [ ] **Step 3: Implement pure helpers**

Base selection on array order, not click order. Return `null` for an empty, missing, or non-contiguous selection. Derive range start/end from first/last selected lines; loop when time is at or beyond range end.

- [ ] **Step 4: Verify and commit**

Run: `npm run test -- --run tests/domain/practiceRange.test.ts`

```bash
git add src/domain/practiceRange.ts tests/domain/practiceRange.test.ts && git commit -m "feat: add lyric practice ranges"
```

### Task 5: Build public library states and navigation

**Files:** Create `src/components/SongLibrary.tsx`; modify `src/app/App.tsx`, `src/app/App.test.tsx`.

**Consumes:** `listPublishedSongs` and `Song`.

**Produces:** loading, error, empty, search, and song-card public library UI.

- [ ] **Step 1: Write failing UI tests**

```tsx
test('shows an empty message when the catalog has no songs', async () => {
  mockedListPublishedSongs.mockResolvedValue([]);
  render(<App />);
  expect(await screen.findByText(/no songs published/i)).toBeInTheDocument();
});
test('shows published songs and filters by title', async () => {
  mockedListPublishedSongs.mockResolvedValue([supernova]);
  render(<App />);
  await user.type(await screen.findByRole('searchbox', { name: /search songs/i }), 'super');
  expect(screen.getByText('Supernova')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests; expect failure**

Run: `npm run test -- --run src/app/App.test.tsx`

- [ ] **Step 3: Implement library experience**

Fetch on mount. Render `Loading songs…`, an error with `Try again`, `No songs published yet`, and an accessible search box. Each card shows title and one `Practice` button only. Do not render create/edit/import/export controls. Maintain selected song state in `App` and pass it to `PracticePanel`.

- [ ] **Step 4: Verify and commit**

Run: `npm run test -- --run src/app/App.test.tsx`

```bash
git add src/app src/components/SongLibrary.tsx src/app/App.test.tsx && git commit -m "feat: show public practice catalog"
```

### Task 6: Build YouTube practice mode

**Files:** Create `src/components/YouTubePracticePlayer.tsx`, `src/components/PracticePanel.tsx`, `tests/components/PracticePanel.test.tsx`; modify `src/app/App.tsx`, `src/styles.css`.

**Consumes:** `Song`, `PracticeRange`, `createPracticeRange`, `shouldLoop`.

**Produces:** `PracticePanel({ song, onBack })` with the full visitor practice workflow.

- [ ] **Step 1: Write failing interaction tests**

```tsx
await user.click(screen.getByRole('button', { name: /안녕/i }));
expect(screen.getByText(/selected: 0:02.*0:04/i)).toBeInTheDocument();
await user.click(screen.getByRole('button', { name: /first line/i }));
await user.click(screen.getByRole('button', { name: /third line/i }));
expect(screen.getByRole('alert')).toHaveTextContent(/adjacent/i);
```

- [ ] **Step 2: Run tests; expect failure**

Run: `npm run test -- --run tests/components/PracticePanel.test.tsx`

- [ ] **Step 3: Implement the player adapter**

Use `react-youtube`; support `youtube.com/watch`, `youtu.be`, and `youtube.com/embed` URLs. On range selection call player `seekTo(range.startSeconds, true)` and `playVideo()`. While loop is active, poll `getCurrentTime()` every 100 ms; at `shouldLoop` seek to range start and resume. Offer 0.75, 1, and 1.25 playback rates. Render `role="alert"` if the YouTube embed reports an error.

- [ ] **Step 4: Implement lyric selection UI**

Render every line as a toggle button containing Korean and optional romanization/meaning. Allow one line or contiguous range, refuse gaps with an adjacent-lines alert, show selected bounds in `m:ss`, include `Play once` and `Loop selected range`, and highlight the line whose timestamp range contains current player time. Include `Back to library`.

- [ ] **Step 5: Verify and commit**

Run: `npm run test -- --run && npm run build`

```bash
git add src/app src/components src/styles.css tests/components && git commit -m "feat: practice public songs with YouTube"
```

### Task 7: Deploy and verify the public site

**Files:** Create `README.md`; configure deployment environment variables in Vercel or Netlify dashboard.

- [ ] **Step 1: Document local setup and admin workflow**

Document `npm install`, `.env` copied from `.env.example`, `npm run dev`, `npm run test -- --run`, and `npm run build`. Explain that the admin adds songs/lines and changes draft to published through Supabase Dashboard, while the public app cannot write data.

- [ ] **Step 2: Deploy static app**

Create a Vercel or Netlify project from the Git repository. Set build command `npm run build`, output directory `dist`, and both `VITE_SUPABASE_*` environment values. Do not set a service-role secret.

- [ ] **Step 3: Perform production acceptance checks**

From the deployed URL, confirm a published song appears and a draft does not; choose a line to seek; choose adjacent lines to form a range; enable loop and confirm it returns to range start; check empty/error states; and verify there is no visible editing or import/export UI.

- [ ] **Step 4: Run final automated checks and commit**

Run: `npm run test -- --run && npm run build`

```bash
git add README.md && git commit -m "docs: document public practice deployment"
```

## Self-review

- Spec coverage: Task 2 implements cloud storage, published/draft control, and RLS; Task 3 reads/validates catalog data; Task 4 implements valid selection ranges; Task 5 excludes visitor write features while covering library states; Task 6 provides playback and looping; Task 7 verifies deployed read-only behavior.
- Placeholder scan: no incomplete implementation markers or unowned interfaces.
- Type consistency: Task 3 owns `Song`/`LyricLine`, Task 4 owns `PracticeRange`, and Tasks 5–6 consume those types.
