# K-pop Vibrant UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. The implementation owner edits source; independent reviewers may inspect without edits. Deployment guidance was updated to Vercel on 2026-08-26; follow README.md for current commands.

**Goal:** Replace both public screens with the approved Vietnamese, mobile-friendly K-pop Vibrant UI without changing catalog data or musical timing rules.

**Architecture:** Retain App → SongLibrary / PracticePanel → YouTubePracticePlayer and the current repository/domain interfaces. Add one reusable presentational Brand component and one LyricLineButton component to keep view responsibilities small. Shared CSS tokens carry the visual system; no new framework or runtime dependency.

**Tech Stack:** React 19, TypeScript, Vite, native CSS, Supabase, react-youtube, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-26-kpop-vibrant-ui-design.md`

## Global Constraints

- Nền ứng dụng: Lilac rất nhạt `#F7F3FF`; màu chính: Tím `#6933D4`, chữ trắng; nhấn phụ: Lime `#E3FF78`.
- Dùng tiếng Việt cho nhãn, hướng dẫn, thông báo và tên truy cập của điều khiển; giữ thương hiệu Concert Practice, tên bài và nội dung lời/phiên âm/nghĩa từ dữ liệu.
- Không sửa schema, migrations, chính sách truy cập hay dữ liệu Supabase.
- Giữ tìm kiếm theo tên bài, mở/quay lại thư viện, chọn một câu hoặc nhiều câu liền nhau, nhảy đến câu, phát một lần, lặp đoạn, tốc độ 0.75×/1×/1.25× và làm nổi bật câu đang phát.
- Điều khiển chạm tối thiểu 44×44px; chữ thường tối thiểu 4.5:1; reduced motion disables animated scrolling.
- Do not invent artists, cover images, song counts, progress, accounts, or unsupported navigation.
- Preserve the package manager, lockfile and Vercel deployment configuration.
- Browser opening is a preview handoff, not permission for visual/browser QA. Report verification limitations honestly.

## Workspace and baseline

- [x] Confirm worktree preference before creating a worktree; preserve existing `.gitignore` change (companion exclusion).
- [x] Run `npm test -- --run`, record original test count and failures.
- [ ] Before an authorized release, verify access to the existing Vercel project; do not create a replacement if access fails.

## Task 1: Library and shared visual system

**Files:** Create `src/components/Brand.tsx`. Modify `src/app/App.tsx`, `src/components/SongLibrary.tsx`, `src/styles.css`, `src/app/App.test.tsx`, `tests/components/SongLibrary.test.tsx`.

**Interfaces:** Retain `SongLibrary({songs: Song[], onPractice(song: Song): void})`. `Brand()` is a stateless mark and Concert Practice wordmark with decorative CSS bars, used in both screens. App owns loading and selectedSong exactly as before.

- [x] Write tests around user-facing search and Vietnamese state handling. Regression caught: unmatched search silently shows a blank list; button no longer selects the correct song; untranslated accessible names block a Vietnamese UI.

```tsx
await user.type(screen.getByRole('searchbox', { name: /tìm bài hát/i }), 'không có');
expect(screen.getByRole('status')).toHaveTextContent(/không tìm thấy/i);
await user.clear(screen.getByRole('searchbox', { name: /tìm bài hát/i }));
await user.click(screen.getByRole('button', { name: /luyện hát Supernova/i }));
expect(onPractice).toHaveBeenCalledWith(songs[0]);
```

- [x] Run `npm test -- --run src/app/App.test.tsx tests/components/SongLibrary.test.tsx`; expect missing Vietnamese labels/state before implementation.
- [x] Implement semantic Brand, a purple hero, real count, title-derived decorative covers, accessible per-song buttons, empty/no-result states, Vietnamese catalog warnings and a stable loading state.

```tsx
<button type="button" aria-label={`Luyện hát ${song.title}`} onClick={() => onPractice(song)}>
  <span aria-hidden="true" className="play-symbol" />
</button>
{visibleSongs.length === 0 && <p role="status">Không tìm thấy bài hát phù hợp.</p>}
```

- [x] Replace the old global theme with semantic tokens and library layout; preserve usable practice styles until Task 2. Use system font fallbacks, native buttons and CSS shapes; no SVG artwork or external fonts.

```css
:root { --background:#f7f3ff; --surface:#fff; --ink:#231538; --muted:#6e5d7f; --accent:#6933d4; --accent-soft:#ece2ff; --lime:#e3ff78; }
button:focus-visible,input:focus-visible { outline:3px solid var(--accent); outline-offset:4px; }
.song-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr)); gap:16px; }
```

- [x] Re-run targeted tests; run `npm run build`; start retained Vite server, make one HTTP request to its printed URL, then open that URL using the existing preview tab if available. No screenshots/DOM inspection.
- [x] Generate and inspect the missing social-preview image. The implementation owner integrates only a verified usable image.
- [x] Commit this coherent slice after passing targeted tests.

## Task 2: Practice experience and responsive layout

**Files:** Create `src/components/LyricLineButton.tsx`. Modify `src/components/PracticePanel.tsx`, `src/components/YouTubePracticePlayer.tsx`, `src/styles.css`, `tests/components/PracticePanel.test.tsx`, `tests/components/YouTubePracticePlayer.test.tsx`.

**Interfaces:** Keep PracticePanel and player props unchanged. `LyricLineButton` takes `{line: LyricLine, selected: boolean, active: boolean, onSelect(): void, buttonRef(element: HTMLButtonElement | null): void}`. It renders all lyric fields and independent selected/active labels. It does not own playback or selection state.

- [x] Update existing integration tests to Vietnamese labels. Add regressions for independent selected/active states, retaining all pronunciation fields, clearing the last selected line while looping, empty lyrics and reduced-motion auto-follow.

```tsx
await user.click(screen.getByRole('button', { name: /첫 줄/i }));
act(() => { (playerProps.last?.onCurrentTime as (s:number)=>void)(3); });
const first = screen.getByRole('button', { name: /첫 줄/i });
expect(first).toHaveAttribute('aria-pressed','true');
expect(within(first).getByText('Đang phát')).toBeVisible();
expect(within(first).getByText('Đã chọn')).toBeVisible();
```

- [x] Run `npm test -- --run tests/components/PracticePanel.test.tsx tests/components/YouTubePracticePlayer.test.tsx`; verify expected failures.
- [x] Implement compact branded practice header, range summary, speed radios, both playback mode buttons and an explicit no-selection explanation. Selection/loop algorithms stay unchanged; visual loop status is conditional on a valid range.

```tsx
<button disabled={!range} aria-pressed={!looping} onClick={() => setLooping(false)}>Phát một lần</button>
<button disabled={!range} aria-pressed={looping} onClick={() => setLooping(true)}>Lặp đoạn</button>
{looping && range && <p role="status">Đang lặp đoạn đã chọn</p>}
```

- [x] Render LyricLineButton with `lang="ko"`, `aria-pressed`, simultaneous class names, optional vietHan/romanization/meaning, and timestamps. Place adjacency errors by lyrics and show a no-lyrics state.
- [x] Follow active lyric with reduced-motion-aware scrolling. For independently scrolling lyrics, adjust only that container to center the row; do not displace the player by scrolling the entire page. In document-flow fallback, retain normal active-line follow.

```ts
const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
const top = card.offsetTop - list.clientHeight / 2 + card.clientHeight / 2;
list.scrollTo({ top, behavior });
```

- [x] Translate player errors and give iframe a Vietnamese accessible title without changing video ID extraction, seeking, loop boundaries or playback rates.
- [x] Finalize responsive CSS: desktop two columns; mobile stacked player/lyrics; sufficient-height mobile viewport enables an independently scrolling lyric panel; low-height/large-text fallback uses normal document flow. Respect YouTube minimum dimensions with `min-height:200px`, never crop iframe controls.

```css
.video-frame iframe { width:100%; height:auto; aspect-ratio:16/9; min-height:200px; display:block; }
@media (max-width:639px) { .practice-layout { display:flex; flex-direction:column; } }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { scroll-behavior:auto!important; transition:none!important; } }
```

- [x] Run the component tests and whole test suite. Commit after they pass.

## Task 3: Catalog-state integration, metadata and verification

**Files:** Create `tests/components/AppCatalog.test.tsx`. Modify `index.html`, `README.md`, optional `public/og.png` if successfully generated, this plan and the approved spec only for status records.

**Interfaces:** App still consumes `listPublishedSongs(supabase): Promise<Song[]>`; mock only external catalog calls and the YouTube boundary in integration tests. Metadata uses the actual trusted deployment origin only after the existing Vercel production origin is verified.

- [x] Test loading → resolved catalog → practice → return; rejection → Vietnamese alert; empty catalog. A wrong App branch or lost callback must fail these tests.

```tsx
expect(screen.getByRole('status')).toHaveTextContent(/đang tải/i);
await act(async () => resolveCatalog([song]));
await user.click(screen.getByRole('button',{name:`Luyện hát ${song.title}`}));
expect(screen.getByRole('region',{name:'Lời bài hát'})).toBeVisible();
await user.click(screen.getByRole('button',{name:'Về thư viện'}));
expect(screen.getByRole('searchbox',{name:/tìm bài hát/i})).toBeVisible();
```

- [x] Add Vietnamese `lang`, title/description and theme color; set social title/description. Only use a generated image if verified; if no trusted deployment origin can be resolved, document the missing image URL instead of guessing one.

```html
<html lang="vi">
<meta name="description" content="Luyện hát K-pop từng câu cùng video YouTube, phiên âm Việt–Hàn và chế độ lặp đoạn." />
<meta name="theme-color" content="#6933D4" />
```

- [x] Document the new UI and verification boundaries in README; remove no user data or original business tests.
- [x] Run `npm test -- --run`, `npm run build`, `git diff --check`; calculate contrast for actual text/background pairs. CSS review covers 375/768/1024/1440px, long text and low-height fallbacks; distinguish this from unperformed browser QA.
- [x] Use requesting-code-review for an independent read-only review; owner resolves in-scope findings using TDD. Reviewers must not edit the checkout or deploy.
- [ ] On an explicit release request, deploy to the existing Vercel project with `npm run deploy`. Verify the production origin before adding absolute social-image metadata; no replacement project or access change is authorized.
- [x] Use verification-before-completion and finishing-a-development-branch; no merge/push to unrelated remotes without authorization.

## Self-review

Each spec section maps to Tasks 1–3. No domain/database changes or new account features are included. Component interfaces use the existing Song/LyricLine/PracticeRange types. Browser QA and deployment permission boundaries are explicit; social generation is asset-only and does not affect first preview.

## Execution record — 2026-08-26

- User approved the spec. Worktree creation was offered but not confirmed; no worktree was created. Work was kept on `feat/kpop-vibrant-ui` in the existing checkout, preserving `main`.
- Baseline: 22 tests passed. Library RED → GREEN: 4 expected failures, then 6 targeted tests passed. Practice RED → GREEN: 10 expected failures, then 16 targeted tests passed. Navigation focus regression was observed failing before focus management was added.
- A test-hook return value accidentally registered the mock as teardown; corrected the hook to return nothing. The catalog error-state test then passed without changing production error handling.
- Independent review found two Important issues: an error could collapse a constrained phone lyric area, and a fitting independent list could scroll the page. Fixed by keeping panel content in normal flow with only the lyric list height capped, and detecting overflow mode separately from actual overflow. The new fitting-list regression failed before the fix, then passed. Targeted re-review approved both corrections.
- Final verification: 35/35 tests in 9 files passed; production build passed; `git diff --check` passed. Nine actual color pairs passed 4.5:1, ranging from 4.78:1 to 15.55:1. The existing large-bundle warning remains (about 510.53 kB uncompressed / 146.46 kB gzip).
- Local preview: `http://127.0.0.1:5174/`, HTTP 200 verified and opened for the user. No browser visual QA or real YouTube playback testing was performed; responsive review was code-based.
- Social image generated exactly once and inspected, saved as `public/og.png`. Origin-dependent metadata remains pending, explicitly documented in README.
- No replacement hosting project, push, deployment or access modification was attempted during the UI work. Obsolete hosting-specific instructions were removed when the project standardized on Vercel.
- Branch remains local for user review; no merge into main or unrelated remote push.
