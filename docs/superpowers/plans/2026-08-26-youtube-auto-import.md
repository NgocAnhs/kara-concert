# YouTube Auto Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người có token chung chỉ dán link YouTube để tạo bài luyện; tiếng Anh giữ nguyên, chỉ tiếng Hàn được phiên âm.

**Architecture:** Giữ React/Vite và catalog Supabase công khai. Vercel Node Functions xác minh cookie, tiếp nhận job nguyên tử trong PostgreSQL, chạy pipeline có deadline bằng `waitUntil`; cron riêng bảo trì metadata. Backend và secret không nằm trong dependency graph frontend.

**Tech Stack:** React 19, React Router 7, TypeScript, Zod 4, Vitest 3, Supabase/PostgreSQL, Vercel Node Functions, YouTube Data API, Gemini. Dùng HTTP `fetch` cho provider; thêm `@vercel/functions` và các dependency phát triển cần thiết khi thực hiện, khóa phiên bản đã kiểm tra trong lockfile.

**Spec:** [Thiết kế](../specs/2026-08-26-youtube-auto-import-design.md) và [yêu cầu](../specs/2026-08-26-youtube-auto-import-requirements.md). Đọc cả hai trước khi thực hiện; đây là kế hoạch, không phải bằng chứng chức năng đã có.

## Global Constraints

- Không Google OAuth/Supabase Auth, không tài khoản; khách nghe/luyện không cần token.
- Token 32 byte ngẫu nhiên, 43 ký tự base64url; cookie `song_import_session`, HMAC-SHA-256, 8 giờ, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api`, không Domain.
- Origin phải khớp `APP_ORIGIN`; JSON body tối đa 4 KiB; cookie tối đa 2 KiB; không CORS tùy ý. Ngoại lệ máy-gọi-máy duy nhất: cron với `CRON_SECRET` riêng.
- 10 lần thử mở phiên/IP/15 phút, tính cả thành công; 20 lượt xử lý toàn hệ thống/24 giờ; 2 job đồng thời. Mọi counter nguyên tử và tồn tại ngoài bộ nhớ process.
- Video công khai, nhúng được, không live, tối đa 8 phút; không playlist/concert dài. Không tải, lưu hoặc proxy audio/video.
- Deadline 240 giây từ admission, function dự kiến 300 giây; metadata timeout 15 giây; không retry AI tự động. Phải xác minh khả năng runtime của project thực tế.
- Giữ nguyên từng đoạn không phải Hangul khi ghép cách đọc/romanization. Không yêu cầu người dùng nhập lời, nghĩa hoặc timestamps thủ công.
- Job/quota giữ 7 ngày; counter mở phiên tối đa 24 giờ; metadata refresh từ ngày 25, xóa bản không refresh được ở ngày 29, không lưu quá 30 ngày. Thiếu heartbeat hoặc cũ hơn 48 giờ thì không nhận import mới.
- Bài AI có nhãn “AI tạo — lời và mốc thời gian có thể chưa chính xác”. RLS chặn bài AI thiếu metadata hợp lệ hoặc `needs_reprocess`; bài thủ công giữ hành vi hiện tại.
- RPC quản trị không được `PUBLIC`/`anon`/`authenticated` thực thi; không đặt service credential trong `VITE_*`, Git, URL, log hoặc argv.
- Tính năng mặc định tắt. Không đổi hosting, tự nâng gói, tự sửa database từ xa, commit, push hoặc deploy. Mỗi task kết thúc bằng kiểm thử và review diff, không tự commit.

---

## Hiện trạng và cách thực hiện

Ngày lập kế hoạch 2026-08-26: đã chạy `npm run test -- --run`, **8 file / 48 test đạt**. Chưa chạy DB, provider, browser hoặc deployment cho tính năng mới. Chưa có `api/`, server modules, Supabase local config, `dev:full`, `test:db`, `check:server`.

Workspace đang có thay đổi ở `.gitignore`, `.vercelignore`, `src/components/LyricLineButton.tsx`, `src/styles.css`, `tests/components/PracticePanel.test.tsx` và hai spec chưa track. Không reset/stash/ghi đè chúng. Trước khi code dùng skill `using-git-worktrees`: nếu tạo worktree mới, mang bản sao chính xác spec và các thay đổi nền cần thiết sang bằng patch có kiểm tra, không commit hộ; không copy secret vào worktree tự động. Chạy lại baseline trong workspace thực thi.

Đây là một luồng tính năng liên kết chặt, chia thành ba mốc review: **A: task 1–3, API mở phiên an toàn; B: task 4–7, pipeline và bảo trì; C: task 8–9, UI và nghiệm thu**. Làm tuần tự; có thể dừng ở từng mốc mà import vẫn tắt. Mỗi task theo TDD: thêm ca lỗi → chạy thấy lỗi đúng nguyên nhân → code tối thiểu → chạy lại → review diff. Không đánh dấu bước đạt chỉ vì có mock.

## Bản đồ file và trách nhiệm

| Vùng | File tạo mới / sửa | Trách nhiệm |
| --- | --- | --- |
| Runtime | `server/config.ts`, `server/http.ts`, `server/runtime.ts`, `tsconfig.server.json`, `scripts/dev-full.mjs`, `scripts/server-env.mjs` | Config fail-closed, adapter HTTP, composition, local secret loading |
| Hợp đồng | `shared/import.ts`, `server/imports/types.ts` | JSON public không secret; types nội bộ job/provider |
| Access | `server/access/session.ts`, `server/access/handler.ts`, `server/access/client-ip.ts`, `api/access.ts` | HMAC cookie, Origin, rate limit, endpoint |
| Database | `server/db.ts`, `server/imports/repository.ts`, `supabase/config.toml`, migrations `005`–`008` | Credential backend, RPC, RLS, lease và quota |
| Pipeline | `server/imports/youtube-url.ts`, `server/imports/lyrics.ts`, `server/imports/youtube.ts`, `server/imports/gemini.ts`, `server/imports/runner.ts` | URL chuẩn, giữ tiếng Anh, metadata, AI, điều phối |
| API import | `server/imports/handler.ts`, `api/imports/index.ts`, `api/imports/[id].ts` | Auth trước mọi nghiệp vụ; nhận và đọc trạng thái |
| Bảo trì | `server/maintenance.ts`, `api/internal/maintenance.ts` | Cron auth, refresh/delete metadata, dọn dữ liệu, heartbeat |
| UI | `src/features/import/{client.ts,AccessForm.tsx,ImportPage.tsx,ImportStatusPage.tsx}`, `src/app/useCatalog.ts` | Nhập token/link, poll và phục hồi phiên, refresh catalog |
| UI hiện có | `src/app/App.tsx`, `src/domain/song.ts`, `src/repositories/songRepository.ts`, `src/components/{SongLibrary,PracticePanel}.tsx`, `src/styles.css` | Routes, provenance, nhãn AI; giữ routing/lyric UI cũ |
| Kiểm chứng | `tests/server/`, `supabase/tests/`, `tests/db/`, `tests/components/`, `scripts/{test-db.mjs,check-client-secrets.mjs,benchmark-import.ts}` | Unit, DB thật, UI, artifact, benchmark có chủ ý |

## Task 1: Nền server/local và hợp đồng dữ liệu

**Files:** Create `shared/import.ts`, `server/imports/types.ts`, `server/config.ts`, `scripts/server-env.mjs`, `scripts/dev-full.mjs`, `tsconfig.server.json`, `tests/server/config.test.ts`, `tests/server/serverEnv.test.ts`. Modify `package.json`, `package-lock.json`, `README.md`, `.gitignore`, `.vercelignore` khi cần giữ secret ngoài artifact.

**Interfaces:** `readServerConfig(env): ServerConfig`; `loadServerEnv({processEnv, tokenText, serverText}): Record<string,string>`. Parser file env là dữ liệu, không `source`/shell expansion. Các type dùng xuyên suốt:

```ts
// shared/import.ts — không import bất kỳ server module nào
export type JobStatus = 'checking_video' | 'transcribing' | 'enriching'
  | 'completed' | 'failed' | 'expired';
export type PublicJob = {
  jobId: string; status: JobStatus; stage: JobStatus; deadlineAt: string;
  songId?: string; errorCode?: string;
};
export type ImportReply =
  | { songId: string }
  | { jobId: string; status: JobStatus; statusUrl: string };

// server/imports/types.ts — chỉ backend
export type Lease = { jobId: string; leaseToken: string; deadlineAt: string };
export type VideoMetadata = {
  videoId: string; title: string; durationSeconds: number;
  isPublic: boolean; embeddable: boolean; isLive: boolean;
  playable: boolean; fetchedAt: string; expiresAt: string;
};
export type TranscriptLine = { text: string; start: number; end: number };
export type Transcript = { title: string; lines: TranscriptLine[] };
export type PreparedSong = {
  title: string;
  lines: Array<TranscriptLine & { vietHan: string; romanization: string; meaning: string }>;
};
```

- [x] Thêm test config với env giả; thiếu token/origin không được trở thành config hợp lệ. Import disabled không bắt buộc key provider để chạy unit/UI, nhưng mở tính năng phải đủ key, model và cờ. Ví dụ khởi đầu:

```ts
import { expect, it } from 'vitest';
import { readServerConfig } from '../../server/config';
it('refuses an empty access secret', () => {
  expect(() => readServerConfig({ APP_ORIGIN: 'http://127.0.0.1:3000' }))
    .toThrow('CONFIG_UNAVAILABLE');
});
```

- [x] Chạy `npm run test -- --run tests/server/config.test.ts tests/server/serverEnv.test.ts`; xác nhận lỗi vì module/behavior chưa có.
- [x] Tạo `ServerConfig` với token/origin bắt buộc; `IMPORT_ENABLED` mặc định false, `GEMINI_MODEL` cấu hình rõ, key provider/db chỉ yêu cầu tại nghiệp vụ dùng chúng. Bổ sung `@types/node`, `@vercel/node`, `vercel`, `tsx`, `supabase`, `pg`, `@types/pg` devDependencies và `@vercel/functions` dependency sau kiểm tra phiên bản/runtime; không dùng phiên bản phỏng đoán trong code.
- [x] Viết loader allowlist đúng spec mục 7.1, thêm `GEMINI_MODEL`, `IMPORT_ENABLED` và chế độ local nội bộ. File env trùng key mâu thuẫn phải lỗi; process env rõ ràng ưu tiên nhưng xung đột với file cũng phải báo, không chọn ngầm. Không ghi giá trị vào lỗi. Wrapper dùng `spawn` không shell, bind loopback:

```js
// Trong scripts/dev-full.mjs sau đọc tokenText/serverText từ hai file local.
const serverEnv = loadServerEnv({ processEnv: process.env, tokenText, serverText });
const vercelExecutable = new URL('../node_modules/.bin/vercel', import.meta.url);
spawn(fileURLToPath(vercelExecutable), ['dev', '--listen', '127.0.0.1:3000'], {
  env: { ...process.env, ...serverEnv }, stdio: 'inherit', shell: false,
});
```

- [x] Thêm scripts; `tsconfig.server.json` strict/noEmit, Node types, include `api`, `server`, `shared`; unit server dùng `// @vitest-environment node` từng file, không đổi toàn suite jsdom. Vercel dev command giữ `npm run dev`, không `dev:full`.

```json
{
  "dev:full": "node scripts/dev-full.mjs",
  "check:server": "tsc -p tsconfig.server.json --noEmit",
  "test:db": "node scripts/test-db.mjs"
}
```

- [x] Chỉ thêm `test:db` khi script task 2 có thật; không để command hỏng ở mốc review. Kiểm tra parser với `$()`, backticks, newline trong giá trị, duplicate key, key không allowlist: không thực thi nội dung, không lộ secret. Chạy lại unit và `npm run check:server`.
- [x] README phân biệt Vite UI và local API, ghi các script đã thực sự có. Đọc diff và xác nhận không di chuyển secret thật hoặc thay UI.

## Task 2: Schema nội bộ, RLS và counter mở phiên

**Files:** Create `supabase/config.toml`, `supabase/migrations/005_import_storage.sql`, `supabase/tests/import_permissions.test.sql`, `supabase/tests/access_limits.test.sql`, `scripts/test-db.mjs`, `server/db.ts`, `tests/server/dbGuard.test.ts`. Modify `package.json`, `.gitignore`, `README.md`.

**Interfaces:** `createServerDb(config)` chỉ server, Supabase session persistence/refresh tắt. RPC `consume_access_attempt(p_ip_hash text)` → `{ allowed: boolean, retry_after_seconds: number }`. RPC không nhận timestamp từ browser; dùng thời gian database. Schema chung task 5/7:

| Bảng nội bộ (schema public, RLS không policy client) | Trường chính |
| --- | --- |
| `import_jobs` | uuid id, video_id, status, stage, uuid lease_token, admitted_at, deadline_at, song_id, error_code |
| `import_attempts` | job_id unique, admitted_at; index theo admitted_at |
| `access_attempts` | ip_hash, attempted_at; index theo ip_hash/thời gian |
| `youtube_metadata` | video_id PK, title, duration_seconds, is_public, embeddable, is_live, playable, fetched_at, expires_at |
| `import_runtime` | singleton id=1, maintenance_completed_at, maintenance_lease_token, maintenance_deadline_at |

`songs` thêm `youtube_video_id text`, `source text default 'manual'` với CHECK manual/ai, `ai_model`, `prompt_version`, `needs_reprocess boolean default false`. Index unique video ID sau backfill có kiểm tra. Metadata cache lưu đúng dữ liệu cần dùng; availability tổng hợp từ public/embeddable/live, không giữ raw response.

- [x] Viết pgTAP cho quyền hiệu lực; ví dụ sau tạo extension pgTAP trong môi trường test:

```sql
begin;
select plan(3);
select ok(not has_function_privilege('anon',
  'public.consume_access_attempt(text)', 'EXECUTE'), 'anon denied');
select ok(not has_function_privilege('authenticated',
  'public.consume_access_attempt(text)', 'EXECUTE'), 'authenticated denied');
select ok(has_function_privilege('service_role',
  'public.consume_access_attempt(text)', 'EXECUTE'), 'backend allowed');
select * from finish();
rollback;
```

- [x] Tạo cấu hình local với project_id riêng `concert-practice-import-test`. Script `test-db.mjs` chỉ dùng CLI local và PostgreSQL loopback từ local status (capture, không in key); từ chối URL database không loopback, không nhận `--linked` hoặc `--db-url` từ argv. Chạy migration up trên local, pgTAP và tests concurrency sau này; không reset DB tự động. Không chạy lệnh `db push`, `db reset --linked`, migration repair production. Xác nhận test RED trước migration mới; thiếu Docker phải báo blocked DB tests, không đổi thành mock.
- [x] Viết migration transaction: bật RLS, revoke table/sequence/function từ PUBLIC và client cùng transaction, grant tối thiểu service_role. Function rate limit lấy advisory transaction lock theo ip_hash, đếm cửa sổ 15 phút; attempt thứ 11 trả denied và Retry-After theo mốc attempt đầu còn trong cửa sổ. Không log IP/raw token.

```sql
revoke execute on function public.consume_access_attempt(text)
  from PUBLIC, anon, authenticated;
grant execute on function public.consume_access_attempt(text) to service_role;
```

- [x] Backfill chỉ video ID từ URL hợp lệ bằng quy tắc task 4; collision phải raise và rollback toàn migration, không xóa/gộp bài. Không sửa file migration 001–004 hoặc lời cũ. Kiểm tra CLI có nhận filename 001–005 hiện có trước khi áp dụng; không đổi tên history sản xuất để ép CLI chạy.
- [x] Thêm test 10 allowed/11 denied, cửa sổ hết hạn, lỗi database, quyền đọc/ghi bảng của hai role client. Thực sự gọi RPC trái quyền, không chỉ assert grants. Chạy `npm run test:db` và unit server; ghi rõ phần chưa chạy.
- [x] Review migration với catalog cũ: bài manual published vẫn đọc được, draft vẫn ẩn, không đổi title/slug/lời; README sửa câu “never add service-role key to this project” thành chỉ được giữ backend secret, không browser/Git.

## Task 3: API kiểm tra token và phiên cookie

**Files:** Create `server/access/session.ts`, `server/access/client-ip.ts`, `server/access/handler.ts`, `server/http.ts`, `server/runtime.ts`, `api/access.ts`, `tests/server/session.test.ts`, `tests/server/accessHandler.test.ts`, `tests/server/http.test.ts`. Modify `vercel.json`.

**Interfaces:** `createSession(token: string, nowSeconds: number): string`; `verifySession(cookieValue: string, token: string, nowSeconds: number): boolean`; `createAccessHandler(deps): (req: VercelRequest, res: VercelResponse) => Promise<void>`. Deps gồm config, now, `consumeAttempt(ipHash)` RPC task 2, `trustedIp(req): string | null`. `requireImportSession(req, config)` dùng chung API import, ném lỗi an toàn trước mọi DB/provider.

- [x] Thêm unit cookie đúng/sai/rotation/hết hạn; ví dụ thời hạn tuyệt đối:

```ts
import { expect, it } from 'vitest';
import { createSession, verifySession } from '../../server/access/session';
it('expires at exactly eight hours and rejects rotation', () => {
  const token = 'A'.repeat(43);
  const value = createSession(token, 1_000);
  expect(verifySession(value, token, 1_000 + 28_799)).toBe(true);
  expect(verifySession(value, token, 1_000 + 28_800)).toBe(false);
  expect(verifySession(value, 'B'.repeat(43), 1_001)).toBe(false);
});
```

- [x] Chạy `npm run test -- --run tests/server/session.test.ts tests/server/accessHandler.test.ts tests/server/http.test.ts`; xác nhận RED.
- [x] Viết SHA256 digest constant-time cho token, derive signing key HMAC với nhãn `song-import-session:v1`, purpose/version/nonce/iat/exp. Xác minh signature bytes trước schema, reject duplicate cookies/encoding malformed/>2KiB/future iat>60s/TTL khác 28800. IP dùng HMAC key nhãn riêng; không dùng signing key trực tiếp làm hash IP.
- [x] Implement HTTP guards và `api/access.ts`: GET trạng thái; POST Origin→JSON/body/schema→rate limit→token→Set-Cookie; DELETE Origin+JSON `{}`→clear cookie kể cả phiên cũ. JSON malformed/schema trả400; token string rỗng/sai format/không khớp trả401 chung. 403/413/415/429/503, no-store và method405 có Allow. Cấu hình thiếu phải 503, provider chưa cấu hình không chặn việc unit test session.

```ts
res.setHeader('Cache-Control', 'no-store');
res.setHeader('Set-Cookie', `song_import_session=${value}; Path=/api; Max-Age=28800; HttpOnly; Secure; SameSite=Strict`);
res.status(200).json({ unlocked: true, expiresAt });
```

- [x] Trusted-IP adapter local chỉ loopback+explicit wrapper mode, bucket `local-dev`; production cần chứng minh header IP nào Vercel ghi đè và đường gọi nào được tin cậy. Nếu chưa xác minh thì trả503 cho POST access, không fallback client X-Forwarded-For. Test client tự thay IP không tạo counter mới. Không disable limiter trong production.
- [x] Sửa SPA routing loại `/api` và `/api/*` khỏi catch-all; verify bằng request thực trên `dev:full`, không chỉ đọc JSON. API lạ phải 404 không HTML; `/practice/:slug` vẫn shell. Function config Node/maxDuration phải được CLI build xác nhận; chưa bật import.
- [x] Chạy suite task 3, `check:server`, `build`; kiểm tra Origin thiếu/null, cookie giả, rate limit đồng thời, logout và rotation. Review diff, ghi mốc **A**: API access local đạt hay còn thiếu môi trường, không tuyên bố đã có import.

**Kiểm chứng còn chặn:** HTTP mở phiên qua database thật (chưa được phép đọc khóa local), chunked trên Node24 và trusted-IP triển khai. Không coi mốc A hoàn tất; giữ import tắt.

## Task 4: URL, provider và ghép lời giữ nguyên tiếng Anh

**Files:** Create `server/imports/youtube-url.ts`, `server/imports/lyrics.ts`, `server/imports/youtube.ts`, `server/imports/gemini.ts`, `tests/server/youtubeUrl.test.ts`, `tests/server/lyrics.test.ts`, `tests/server/providers.test.ts`.

**Interfaces:** `parseYouTubeUrl(input): {videoId: string; canonicalUrl: string}`; `fetchVideo(videoId, {signal}): Promise<VideoMetadata>`; `transcribe(canonicalUrl, {signal}): Promise<Transcript>`; `enrich(transcript, {signal}): Promise<PreparedSong>`; `validatePreparedSong(value, durationSeconds): PreparedSong`.

`splitLyric(text): Segment[]`, `Segment = {id: number; kind: 'hangul'|'literal'; text: string}`. `assembleReading(segments, replacements: Record<number,string>): string` thay đúng Hangul id, giữ literal byte-for-byte. Enrichment trả replacement `{segmentId,vietHan,romanization}` và meaning theo lineId; code ghép cả hai readings, không dùng trường rewritten-English từ model.

- [x] Thêm ca tiếng Anh và mixed thật sự kiểm tra code ghép, không assert prompt:

```ts
import { expect, it } from 'vitest';
import { splitLyric, assembleReading } from '../../server/imports/lyrics';
it('preserves English casing, spaces and curly apostrophes', () => {
  const segments = splitLyric('난 I’m coming HOME!');
  const korean = segments.find(s => s.kind === 'hangul')!;
  expect(assembleReading(segments, { [korean.id]: 'Nan' }))
    .toBe('Nan I’m coming HOME!');
  expect(assembleReading(splitLyric("I'm coming home"), {}))
    .toBe("I'm coming home");
});
```

- [x] Chạy `npm run test -- --run tests/server/youtubeUrl.test.ts tests/server/lyrics.test.ts tests/server/providers.test.ts`; xác nhận RED.
- [x] Parse URL bằng URL API: https, host exact `youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`; hỗ trợ `/watch?v=`, `/shorts/:id`, `/embed/:id` và short link. ID đúng 11 ký tự `[A-Za-z0-9_-]`, không credentials/custom port, từ chối `list`, duplicate v, playlist path và host giả. Loại t/si/tracking; chỉ fetch endpoint API cố định, không URL người dùng. Không áp quy tắc mới lên player/bài cũ có ID fixture ngắn.
- [x] Implement provider YouTube `videos.list` parts snippet/contentDetails/status, đọc ISO8601 duration, public+embeddable, không upcoming/live; reject age/restriction nếu response cho biết không phù hợp. Với region restriction không thể bảo đảm phát mọi nơi: từ chối trong MVP hoặc giữ thông báo lỗi playback; không gọi metadata “bảo đảm phát”. Timeout15s, không retry, không trả URL chứa key/raw errors ra client. Kiểm tra video≤480s, thiếu items, quota403, response schema sai.
- [x] Implement Gemini HTTP theo request format chính thức đã kiểm tra khi code; model server-configurable. Transcript trả title và lines, tiếng hát/video là dữ liệu không phải instructions. Hai calls transcript/enrichment có structured JSON schema, output budget hữu hạn, verify finish reason và JSON completeness; không fallback model/guess lời khi lỗi. Trước gọi tiếp phải còn deadline; dùng AbortSignal từ runner. Không log full transcript/provider response.
- [x] `splitLyric` dùng Unicode Hangul/Jamo; giữ mọi literal; reject alphabet ngoài phạm vi hỗ trợ thay vì suy đoán phiên âm. Batch toàn bộ Hangul segments với ID để giảm calls; pure English vẫn cần nghĩa nhưng readings được code copy từ transcript. Validate thiếu/duplicate/extra replacement IDs. Không sửa text để hợp thức hóa output AI.
- [x] Validation có schema limits rõ: title≤200 ký tự, 1–500 lines, text/reading/meaning mỗi trường≤2000 ký tự, thời gian finite/nonnegative/start<end≤duration, thứ tự và không overlap. Reject nguyên output khi vi phạm; không clamp timing, không cắt câu. Kiểm tra pure English vẫn vào `viet_han`, `romanization` khi lưu vào schema cũ `korean` chứa transcript gốc.
- [x] Chạy lại suite task 4 bằng fetch mock; không API thật. Review diff và lưu request fixtures tổng hợp không chứa key/lời lấy từ nguồn chưa được phép.
- [x] Nếu đã có cấu hình test và được phép dùng quota, ưu tiên probe toàn bài có chủ ý ngay sau task này để phát hiện sớm giới hạn thời gian/chất lượng. Probe không ghi catalog và không thay thế bộ nghiệm thu task9; nếu trượt rõ ràng thì báo trước khi đầu tư tiếp phần UI.

**Kiểm chứng còn chặn:** model Gemini được cấu hình và chất lượng/thời gian toàn bài chưa chạy live; không bật import.

## Task 5: Admission nguyên tử, repository và hoàn tất có fencing

**Files:** Create `supabase/migrations/006_import_jobs.sql`, `supabase/tests/import_jobs.test.sql`, `tests/db/importConcurrency.test.ts`, `server/imports/repository.ts`, `tests/server/importRepository.test.ts`, `vitest.db.config.ts`. Modify `scripts/test-db.mjs`, `vite.config.ts`.

**Interfaces:** `admit(videoId): Promise<Admission>` với:

```ts
type Admission =
  | { kind: 'cached'; songId: string }
  | { kind: 'existing'; job: PublicJob }
  | { kind: 'created'; job: PublicJob; lease: Lease }
  | { kind: 'rejected'; code: string; retryAfterSeconds?: number };
```

`advance(lease, 'transcribing'|'enriching'): Promise<boolean>`; `fail(lease,errorCode): Promise<void>`; `complete(lease,metadata,prepared): Promise<string>`; `completeCached(lease,metadata): Promise<string>`; `getJob(jobId): Promise<PublicJob|null>`. Nội bộ `getVideoState(videoId)` trả `{ source: 'manual'|'ai', status: 'draft'|'published', needsReprocess: boolean, metadata: VideoMetadata|null } | null` bằng backend credential, không expose HTTP; runner dùng để chọn cache shortcut, RPC hoàn tất luôn kiểm tra lại trong lock.

RPC tương ứng `admit_import(p_video_id text)`, `advance_import(p_job_id uuid,p_lease_token uuid,p_stage text)`, `fail_import(p_job_id uuid,p_lease_token uuid,p_error_code text)`, `complete_import(p_job_id uuid,p_lease_token uuid,p_metadata jsonb,p_song jsonb)`, `complete_cached_import(p_job_id uuid,p_lease_token uuid,p_metadata jsonb)`, `read_import(p_job_id uuid)`. Mọi hàm cùng quy tắc revoke/grant service_role và kiểm tra kiểu payload server.

- [x] Viết pgTAP và concurrency test qua hai kết nối PostgreSQL local độc lập: gửi 10 admissions cùng video chỉ có1created, còn lạiexisting; video khác không quá2active; đủ20attempts thì từ chối lần21. Test cached/existing vẫn trả khi quota hết. Không dùng in-memory mock để chứng minh lock.

```ts
// repository dùng pool PostgreSQL local với ít nhất hai connections.
const calls = Array.from({ length: 10 }, () => repository.admit('1CTced9CMMk'));
const results = await Promise.all(calls);
expect(results.filter(r => r.kind === 'created')).toHaveLength(1);
expect(new Set(results.flatMap(r =>
  r.kind === 'created' || r.kind === 'existing' ? [r.job.jobId] : []
)).size).toBe(1);
```

- [x] Chạy `npm run test:db` trước migration006; xác nhận thiếu RPC/behavior đúng nguyên nhân.
- [x] Implement admission với advisory transaction lock toàn cục; expire jobs trước đếm active, partial unique index video trên trạng thái active; cached manual published trả ngay, AI phải fresh/playable/no-reprocess. Draft bị chặn; cache trước quota. Sau đó kiểm tra feature gate ở API và heartbeat trong DB, count24h<20, active<2, insert job+attempt atomically. Lease UUID do DB tạo, deadline DB now+240s. Không gọi provider bên trong transaction.
- [x] Implement stage updates bằng compare-and-set trạng thái cũ và lease/deadline; lỗi DB không giả thành thành công. `complete_import` khóa job và song, kiểm tra lease còn hiệu lực cùng publication status tại lúc ghi, revalidate JSON và constraints, upsert song+replace all lines+metadata+completed trong1transaction. Không republish draft do admin đặt lúc worker đang chạy. Bài AI reprocess giữ id/title hiện có để không đổi slug; new song dùng AI title. Xóa `needs_reprocess` chỉ tại success toàn pipeline.
- [x] `complete_cached_import` chỉ thành công nếu có metadata đối chiếu trước cập nhật, duration không đổi và cờ false; thiếu baseline/mất timing thì không shortcut. `fail_import` chỉ active lease đúng, không đổi terminal; stale không ghi gì. read/admit reclaim job expired, retry tạo ID mới, daily attempt không refund. Không purge attempts còn cửa sổ quota.
- [x] Test rollback giữa insert lyrics không lộ song nửa chừng, kill sau admission trước metadata, late completion, admin draft race, invalid duration, retry ID mới, raw lease không trong PublicJob. Script DB chạy cả pgTAP và concurrency suite, unit bình thường exclude `tests/db/**`; DB suite dùng explicit test config Node, không tự gọi prod.
- [x] Thêm `vitest.db.config.ts` include chỉ `tests/db/**/*.test.ts`, Node environment; giữ default excludes của Vitest khi thêm DB exclude vào `vite.config.ts`. Script DB truyền local connection qua env child process, không argv, từ chối connection không loopback trước mở pool. Chạy suite DB tuần tự với fixture transaction/cleanup để test quota không bị nhiễu từ test khác.
- [x] Chạy `test:db`, `npm run test -- --run tests/server/importRepository.test.ts`, `check:server`; review effective PUBLIC privileges cho từng signature mới.

## Task 6: Runner và API nhập/theo dõi

**Files:** Create `server/imports/runner.ts`, `server/imports/handler.ts`, `api/imports/index.ts`, `api/imports/[id].ts`, `tests/server/importRunner.test.ts`, `tests/server/importHandler.test.ts`. Modify `server/runtime.ts`, `vercel.json`.

**Interfaces:** `runImport(lease: Lease, videoId: string, deps): Promise<void>` consumes repository/provider task4–5. `createImportHandler(deps)` và `createImportStatusHandler(deps)` trả Vercel handlers; deps inject `background(promise): void`, mặc định `waitUntil`, không store task trong memory.

- [x] Thêm handler test thiếu cookie từ chối trước side effects; mock req/res theo `api/access` tests, không tạo harness framework mới. Khi config hợp lệ và POST Origin/JSON đúng nhưng không cookie:

```ts
expect(res.statusCode).toBe(401);
expect(admit).not.toHaveBeenCalled();
expect(fetchVideo).not.toHaveBeenCalled();
expect(transcribe).not.toHaveBeenCalled();
```

- [x] Chạy `npm run test -- --run tests/server/importRunner.test.ts tests/server/importHandler.test.ts` và thấy RED.
- [x] Implement POST guard→parse URL→admit; cached200/existing202 không schedule; chỉcreated schedule runner. Đăng ký `waitUntil` trước kết thúc response. Nếu đăng ký lỗi, fail lease đã nhận; quota attempt không refund. GET xác minh cookie trước validate/lookup ID; unknown404 sau auth, thiếucookie luôn401; no-store, không lease/raw provider. Body chỉ youtubeUrl≤4KiB.

```ts
if (admission.kind === 'created') {
  background(runImport(admission.lease, videoId, runnerDeps));
  res.status(202).json({
    jobId: admission.job.jobId, status: 'checking_video',
    statusUrl: `/api/imports/${admission.job.jobId}`,
  });
}
```

- [x] Runner metadata→cache shortcut hợp lệ hoặc advance transcribing→transcript→advance enriching→enrichment→validation→complete. Abort deadline chung; metadata trần15s; không bắt đầu step sau deadline. Dùng finally clear timers và catch safe error mapping, fail RPC nếu còn lease; nếu DB lỗi để lease expire, không unhandled rejection. Cookie logout/expiry không hủy job đã admitted.
- [x] Test schedule đúng một lần, provider fail/truncated, metadata reject, no automatic retry, deadline lúc mỗi stage, complete từ stale worker không ghi, poll expired không cần worker sống. Phân biệt `failed` và `expired`; `Retry-After` cho quota/concurrency; không hiển thị tiến độ phần trăm giả.
- [x] Chạy unit/server typecheck và local HTTP request endpoints với mocks trong test, provider thật chỉ ở task9. Build Vercel kiểm chứng Node function/maxDuration300 không bị SPA fallback; nếu CLI cần project credentials thì báo rõ, không link project khác. Review diff.

**Kiểm chứng còn chặn:** background/lifetime trên deployment và provider thật chưa được phép chạy; giữ import tắt.

## Task 7: Bảo trì metadata và RLS public

**Files:** Create `supabase/migrations/007_metadata_visibility.sql`, `supabase/migrations/008_maintenance.sql`, `supabase/tests/metadata_visibility.test.sql`, `supabase/tests/maintenance.test.sql`, `server/maintenance.ts`, `api/internal/maintenance.ts`, `tests/server/maintenance.test.ts`. Modify `server/runtime.ts`, `vercel.json`.

**Interfaces:** RPC `begin_maintenance()` → `{lease_token,deadline_at}|null`; `cleanup_import_data(p_lease_token uuid)`; `apply_metadata_refresh(p_lease_token uuid,p_metadata jsonb)`; `mark_metadata_unavailable(p_lease_token uuid,p_video_id text)`; `finish_maintenance(p_lease_token uuid)`; `runMaintenance(deps): Promise<void>`. `can_read_imported_song(p_song_id uuid): boolean` là helper RLS chỉ đọc, không trả metadata/draft và không query cùng policy đệ quy. Hàm config cron riêng chỉ yêu cầu `CRON_SECRET` và database credential; thiếu token/Gemini không được khiến bảo trì ngừng chạy.

- [x] Test pgTAP ngày25/29/30, missing cache, needs_reprocess sticky, manual/draft và nested lyric query. Chuẩn bị fixture trong transaction test (không production); đổi timestamps bằng SQL fixture. Test cron sai/thiếusecret không gọi RPC/provider, cookie token import không đủ.

```ts
expect(response.statusCode).toBe(401);
expect(beginMaintenance).not.toHaveBeenCalled();
expect(fetchVideo).not.toHaveBeenCalled();
```

- [x] Chạy `npm run test:db` và `npm run test -- --run tests/server/maintenance.test.ts` thấy RED.
- [x] Thay policy permissive `anon reads published songs` cũ (không chỉ thêm policy OR): manual published được đọc; AI published cần fresh/playable/no-reprocess. Lyrics policy tra cùng điều kiện. Helper definer kiểm tra published qua quyền owner tối thiểu không đệ quy, schema-qualified và search_path cố định; revoke PUBLIC, grant anon helper riêng. Kiểm tra `authenticated` không được RPC quản trị hoặc bảng cache.
- [x] Maintenance có lease fencing riêng; cleanup trước network: purge job/attempt>7days, access>24h, metadata≥29days chưa refreshed; xóa cache và bật needs_reprocess atomically. Refresh batch từ25days theo oldest first, budget riêng; expired lease không apply/finish. Duration changed đặt cờ true, refresh sau không xóa cờ; private/deleted không playable, transient error không kéo TTL. Không Gemini trong maintenance.
- [x] Provider task4 trả lỗi có mã phân loại: chỉ lỗi đã xác định video mất/private/không nhúng mới gọi `mark_metadata_unavailable`; timeout/quota/schema lỗi không chuyển thành “video bị xóa”. RPC unavailable chỉ đặt playable false, không gia hạn TTL. Các RPC refresh/delete/complete cùng khóa song rồi metadata theo thứ tự cố định và đối chiếu thời điểm fetch, để response bảo trì cũ không ghi đè metadata mới hơn từ import.
- [x] GET cron auth bằng digest constant-time `CRON_SECRET`, no-store; không Origin/browser JSON guard, không cookie bypass. Schedule mỗi ngày, cấu hình cron theo UTC và project hiện có, không nâng gói. Ví dụ lịch dự kiến:

```json
{ "crons": [{ "path": "/api/internal/maintenance", "schedule": "0 2 * * *" }] }
```

- [x] Hoàn thành hết batch cần thiết mới cập nhật heartbeat; thiếu/bị ngắt có safe operational error, không báo khỏe giả. Test cron concurrent, hết budget, missing heartbeat/>48h closes admission, maintenance còn chạy khi import disabled. Chạy bảo trì lần đầu trong local có auth trước import e2e.
- [x] Chạy DB+unit; ghi mốc **B** với bằng chứng pipeline mock, transaction/RLS thật tách rõ. Trước release phải chọn và thử kênh cảnh báo thực tế cùng chủ dự án; nếu chưa có cảnh báo thì giữ feature disabled, không coi log là notification.

**Kiểm chứng còn chặn:** kênh cảnh báo, cron và heartbeat production chưa cấu hình/triển khai; import vẫn tắt.

## Task 8: UI token, nhập link, theo dõi và refresh catalog

**Files:** Create `src/features/import/client.ts`, `src/features/import/AccessForm.tsx`, `src/features/import/ImportPage.tsx`, `src/features/import/ImportStatusPage.tsx`, `src/app/useCatalog.ts`, `tests/components/ImportFlow.test.tsx`. Modify `src/app/App.tsx`, `src/domain/song.ts`, `src/repositories/songRepository.ts`, `src/components/SongLibrary.tsx`, `src/components/PracticePanel.tsx`, `src/styles.css`, `tests/domain/song.test.ts`, `tests/repositories/songRepository.test.ts`, `tests/components/AppCatalog.test.tsx`, `tests/components/PracticePanel.test.tsx`.

**Interfaces:** browser client `getAccess()`, `openAccess(token)`, `closeAccess()`, `startImport(youtubeUrl): Promise<ImportReply>`, `getImport(jobId): Promise<PublicJob>`; cùng origin, credentials same-origin, không persist token. `useCatalog()` → `{songs,error,reload(): Promise<Song[]>}`; route `/import`, `/imports/:jobId`; use `createSongRoutes` hiện có để điều hướng kết quả sau reload.

- [x] Đọc skill `ui-ux-pro-max` khi thực hiện UI; giữ style hiện có. Viết test trên mock fetch và catalog đã có: token sai, đang check không submit, English-only hiện trong dòng cách đọc, reload status route, expiry→reunlock→poll same job, complete→reload catalog→practice route. Không thêm field nhập title/lyrics/timestamps.

```ts
// Bổ sung vào fixtures/test hiện có của PracticePanel:
const englishLine = {
  id: 'english', korean: "I'm coming home", vietHan: "I'm coming home",
  romanization: "I'm coming home", meaning: 'Tôi đang trở về nhà.',
  displayOrder: 0, startSeconds: 1, endSeconds: 3,
};
render(<PracticePanel song={{ ...song, lines: [englishLine] }} onBack={() => {}} />);
expect(screen.getAllByText("I'm coming home").length).toBeGreaterThan(0);
```

- [x] Chạy `npm run test -- --run tests/components/ImportFlow.test.tsx tests/components/AppCatalog.test.tsx tests/components/PracticePanel.test.tsx`; xác nhận ca mới RED, không xóa assertion UI người dùng đang sửa.
- [x] Implement AccessForm password input/label, token clear finally, error tiếng Việt, 429 Retry-After, 503 chưa sẵn sàng; no auto retry token. Gửi token duy nhất POSTaccess, không query/localStorage/sessionStorage/analytics. Logout API JSON `{}` + clear UI + stop poll.
- [x] ImportPage GETaccess trước form; chỉ URLinput và submit, show max8min/publication/AIwarning. StatusPage poll 2giây sau response trước (không interval chồng); AbortController cleanup/unmount, stop terminal/401, giữ jobId trong route; reauth poll đúng ID. Retry chỉ POSTimports qua guards, không tạo job tự động khi reload.
- [x] Refactor catalog loader vào useCatalog, bảo vệ stale response/unmount; reload trước navigate. Nếu catalog chưa trả songId completed, giữ trangstatus và nút tải lại; không tự POSTimport lần nữa. Route missing dùng thông báo không tồn tại/không còn khả dụng, không đọc bảng private để giải thích lý do.
- [x] Map source/ai_model/prompt_version từ repository; schema nhận source absent→manual để giữ fixtures/bài cũ. Hiện nhãn AI trong SongLibrary và PracticePanel. Không đổi LyricLineButton hoặc lời cũ để hiện lại Korean ngoài yêu cầu; không thêm server import vào src.
- [x] Test 401 không lộ task, focus heading/keyboard, live region không spam, logout giữ bài, server error không giả thành cached success. Chạy toàn bộ suite, `check:server`, `build`; review diff UI trước browser QA.

## Task 9: Kiểm chứng tích hợp, chất lượng và bàn giao phát hành

**Files:** Create `scripts/check-client-secrets.mjs`, `scripts/benchmark-import.ts`, `tests/server/benchmarkMetrics.test.ts`, `tests/server/clientSecrets.test.ts`, `docs/validation/youtube-import.md`. Modify `README.md`, `package.json`; không đưa sample lyrics không có quyền lưu hoặc raw secrets vào báo cáo.

**Interfaces:** benchmark CLI explicit `--run-live` mới gọi provider, output report ngoài Git; không sử dụng backend production hay bỏ qua API protection. Export `measureLyrics(reference: string,actual: string): number` trả character error rate sau normalization trong spec; `measureTiming(referenceCues: Array<{start:number,end:number}>,actualCues: Array<{start:number,end:number}>)` trả `{withinHalfSecond: number, deltas: Array<{start:number,end:number}>, allWithinOneSecond: boolean}`, trong đó withinHalfSecond là số cue đạt cả hai mốc. Import module trong test không thực thi CLI/provider; entrypoint guard trước chạy. Chỉ dùng bản tham chiếu người hiểu ngôn ngữ đã nghe kiểm tra.

- [ ] Viết metrics tests với câu tổng hợp, kiểm tra insert/delete/substitute và hai mốc cùng phải đạt; bảo vệ cách đo không bỏ câu khó:

```ts
expect(measureLyrics('ABC', 'ADC')).toBeCloseTo(1 / 3);
expect(measureTiming(
  [{ start: 1, end: 3 }], [{ start: 1.4, end: 3.8 }],
).withinHalfSecond).toBe(0);
```

- [ ] Chạy test metrics thấy RED; implement edit distance, normalize NFC/case/whitespace/punctuation chỉ cho đo lời (không áp khi lưu English); timing cue matching theo reference đã chọn trước, mismatched/missing cue là fail, không drop. Không tự generate “ground truth” bằng chính Gemini.
- [ ] Viết artifact scan tự spawn build với fake server secrets đặc trưng được truyền qua env (không argv), rồi kiểm tra `dist`/source maps không chứa literal; fail nonzero nếu phát hiện, chỉ in tên artifact và loại secret, không giá trị. Test scanner trên fixture chứa sentinel rồi fixture sạch. Production secret không cần được đọc để chạy kiểm tra này. Không dùng artifact build bằng fake env để deploy; release luôn build riêng bằng quy trình Vercel đã có.
- [ ] Chạy chuỗi kiểm tra local, từng command độc lập và ghi exit code vào báo cáo:

```bash
npm run test -- --run
npm run test:db
npm run check:server
npm run build
node scripts/check-client-secrets.mjs
npm run dev:full
```

- [ ] Browser QA bằng skill browser: desktop/mobile; guest nghe/luyện; token đúng/sai, submit URL, reload task, session expiry, retry, close session, complete→practice, unknown API không HTML; regression selection/rate/loop và legacy routes. Test thật cookie flags/Origin/body limit qua HTTP, không suy từ unit.
- [ ] Khi có key và quyền dùng quota, chạy 5 video full-song ×2 theo spec6.1, gồm pureKorean/pureEnglish/3mixed, rap/instrumental/repeats/6–8min. Với mỗi bài: CER≤5%, không hallucinated/omitted line; ≥20 cues, ≥90% cả start/end≤0.5s, none>1s, Englishcopy100%, mỗi run≤240s. Human review nghĩa/phát âm Hàn; báo actual tokens/time/finish reason. Thiếu người nghe kiểm chứng hoặc bất kỳ ngưỡng trượt thì giữ feature tắt và báo rõ, không yêu cầu người dùng nhập lời thủ công vào app.
- [ ] Xác minh đúng account/project/domain Vercel, runtime Fluid/300s, trusted IP, secret env production riêng, Data API enabled/key restriction, Supabase migration history và quyền backend, cron/alerts. Chỉ khi được phép mới cấu hình remote/migrate; không chạy destructive reset. README tách setup local, migration có authorization, rotation token, chạy maintenance, incident/rollback.
- [ ] Cập nhật script release để chạy `check:server` cùng test trước quy trình Vercel hiện có; DB test/quality report phải đạt trước release, không chạy provider10lần tự động mỗi deploy. Không chạy `npm run deploy` khi chưa người dùng yêu cầu. Deploy được yêu cầu thì skill verification + AGENTS.md: đúng project, verify URL/API/deep links và cron heartbeat trước bật `IMPORT_ENABLED`; không đưa key vào chat.
- [ ] Review cuối mốc **C**: liệt kê PASS/FAIL/BLOCKED theo unit, DB, browser, live benchmark, deployment; không gộp mock với live. Rollback chỉ tắt import mới, vẫn maintenance và RLSmetadata, không xóa bài cũ.

## Đối chiếu độ phủ thiết kế

| Thiết kế | Task / bằng chứng cần có |
| --- | --- |
| 1–2: scope, kiến trúc, giới hạn waitUntil | 1, 4, 6, 9 / HTTP runtime + benchmark |
| 3.1–3.3: token/cookie/Origin/rotation/rate limit | 2–3, 8 / unit HTTP, DB counter, browser |
| 4: chỉ link, giữ tiếng Anh | 4, 8 / segment tests, UI English, full-song reference |
| 5.1: quyền PUBLIC/RPC/RLS | 2, 5, 7 / effective privileges + real denied calls |
| 5.2: admission/quota/lease/deadline | 5–6 / multi-connection concurrency, failure injection |
| 5.3: metadata/cron/timing invalidation | 7, 9 / DB time fixtures, cron auth, alert verification |
| 6–6.1: validation và chất lượng thực | 4, 6, 9 / malformed fixtures + 10 live runs + human reference |
| 7–7.1: local/testing/regressions | 1–9 / dev:full, DB local, build leakscan, current suite |
| 8: secrets/configuration/release | 1, 3, 7, 9 / fail-closed, correct project, explicit release authorization |

## Tài liệu kỹ thuật cho người thực hiện

- [Vercel Node runtime](https://vercel.com/docs/functions/runtimes/node-js) và [waitUntil](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package): kiểm tra adapter và timeout khi code, không coi background task là hàng đợi bền vững.
- [Gemini video input](https://ai.google.dev/gemini-api/docs/video-understanding): kiểm tra API/model và định dạng gửi YouTube URL đang hỗ trợ trước probe; không dựa vào đoạn thử cũ để hứa chất lượng toàn bài.
- [Supabase local workflow](https://supabase.com/docs/guides/local-development/cli-workflows) và [database tests](https://supabase.com/docs/guides/database/testing): môi trường local/Docker và pgTAP; không dùng flags remote cho test.
- Nguồn về quyền RPC, retention YouTube và cron nằm cuối spec; kiểm tra lại giới hạn gói/model ở thời điểm triển khai.
