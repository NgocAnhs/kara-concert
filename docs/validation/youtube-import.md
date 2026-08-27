# YouTube import validation — milestone C

Date: 2026-08-27 (Asia/Ho_Chi_Minh)

Release decision: **BLOCKED — keep `IMPORT_ENABLED=false`.** Local automated checks passed, while the recorded development-tool audit remains a release risk; browser end-to-end, provider-live quality, and production release gates do not have the required external evidence.

## Evidence matrix

| Scope | Status | Evidence and boundary |
| --- | --- | --- |
| Unit/component/server mocks | **PASS** | `npm run test -- --run`: 25 files, 368 tests, exit 0. This includes benchmark metrics, entrypoint/import safety, manifest validation, atomic-report/symlink fixtures, provider telemetry, safe timeout/quota propagation, nonblank AI-output validation, import error/action UI, strict repository responses, raw invalid UTF-8, and artifact-scanner fixtures. Provider responses and UI import completion are synthetic; this is not provider-live evidence. |
| Real local PostgreSQL | **PASS** | `npm run test:db`: migrations 001–008, 218 pgTAP assertions, 6 concurrency tests, 15 simultaneous service-role calls, exit 0. The runner pinned the isolated loopback project and did not contact a remote database. |
| Server TypeScript | **PASS** | `npm run check:server`, exit 0. |
| Client build and synthetic secret scan | **PASS** | `npm run build` and `npm run check:client-secrets`, exit 0. Scanner performed a separate build with fake server values supplied through env and found none in `dist` or source maps. The synthetic build is not a release artifact. |
| Local Vercel preview build | **PASS** | `npx vercel build`, exit 0. Output contains Node 24 functions with `maxDuration: 300`, the 02:00 UTC cron, and an API 404 route outside the SPA fallback. A nonfatal Vercel update-cache permission warning occurred. This does not prove production Fluid Compute or background lifetime. |
| Local HTTP guards | **PASS (partial)** | With synthetic config and import disabled: wrong Origin 403, oversized body 413, closed session 204 with clearing cookie, unknown API 404 and non-HTML. Disabled access returned 503 and import without a session returned 401 as expected. |
| Browser desktop/mobile | **BLOCKED** | The Browser skill was reviewed, but no honest full-flow browser run was possible: the local server intentionally used no backend credentials and `IMPORT_ENABLED=false`. Correct-token cookie flags, submit/reload/session-expiry/retry/complete→practice and real player behavior remain unverified in a browser. Mocked component coverage must not be relabeled browser E2E. Production `Secure` cookie behavior also requires HTTPS deployment evidence. |
| Five full songs × two provider runs | **BLOCKED** | Not run. No owner authorization for quota, no approved keys, no rights-cleared human references, and no language reviewer were available. The benchmark remains explicit `--run-live`, has no import/database side effects, resolves manifest/report real paths outside Git, and atomically preserves a partial blocked report if a run fails. The two old LOSER probes do not count. |
| Production Vercel/Supabase/YouTube setup | **BLOCKED** | No deploy, remote migration, env/config change, cron invocation, alert setup, or provider call was authorized. Account/project/domain, Fluid 300 seconds, trusted ingress IP, production secrets, Data API/key restriction, remote migration history/effective privileges, heartbeat and notification channel require owner/operator verification. |
| Dependency risk | **FAIL (release risk)** | Full `npm audit --json`: 29 findings (1 critical, 19 high, 7 moderate, 2 low), concentrated in Vercel development tooling; exit 1. `npm audit --omit=dev --json`: 0 runtime findings; exit 0. No forced audit fix was applied. Review/update the Vercel toolchain deliberately before release. |

## Task 9 remediation — round 1

| Scope | Status | Evidence and boundary |
| --- | --- | --- |
| Benchmark safeguards | **PASS** | New focused coverage verifies meaningful normalized references, at least 20 ordered non-overlapping cues across beginning/middle/end, epsilon-inclusive timing thresholds, repeated cue ordering, and arbitrary split/merge matching. A missing/mismatched cue remains a failure. |
| Partial benchmark reporting | **PASS** | Every planned run has an explicit result. Ordinary provider/validation failures retain their safe code, elapsed time, and any response telemetry, then continue independent planned runs. Quota exhaustion or timeout stops later provider calls and records them as not attempted. Publication uses a temporary file plus atomic no-overwrite link outside the repository. No raw provider body or transcript is placed in failed entries. |
| Provider telemetry | **PASS** | Gemini accepts an optional callback carrying only actual `usageMetadata` counts and candidate finish reasons. A successful benchmark requires actual telemetry from both Gemini responses; otherwise it is blocked with `BENCHMARK_TELEMETRY_MISSING`. Pre-response failures explicitly report telemetry unavailable. |
| Real-path containment | **PASS** | References must exist and resolve outside the repository. Report paths resolve their existing parent and are checked again after directory creation. Symlink parents or targets resolving into the repository are rejected. |
| Fresh local verification | **PASS** | `npm run test -- --run`: 25 files, 334 tests, exit 0; `npm run check:server`, `npm run build`, and `npm run check:client-secrets` each exit 0. |
| Browser/live/deploy | **BLOCKED** | Not rerun and not authorized. No provider request, browser E2E session, remote migration, secret change, Vercel deployment, or production action occurred in this round. |
| Dependency risk | **FAIL (release risk)** | The previously recorded full audit still has 29 development-tool findings. It was not rerun or altered during this offline remediation. |

## Task 9 remediation — round 2

| Scope | Status | Evidence and boundary |
| --- | --- | --- |
| Repeated-cue matching | **PASS** | Cue matching still preserves selected-cue order and arbitrary split/merge handling, but now chooses the textual occurrence with the smallest start/end distance to the human reference cue. A test where an earlier identical chorus is unselected confirms the later selected occurrence is measured. |
| YouTube provider timeout | **PASS** | The provider’s own 15-second controller abort now yields the safe `PROVIDER_TIMEOUT` code. An external abort remains distinct and is not relabeled as the provider timeout. The benchmark treats `PROVIDER_TIMEOUT` like quota/time-budget protection: it records the attempted failure and marks all remaining planned runs not attempted, with no automatic retry. |
| Fresh local verification | **PASS** | Focused benchmark/provider tests: 33 assertions, exit 0. Full suite: 25 files, 336 tests; `npm run check:server`, `npm run build`, and `npm run check:client-secrets` all exit 0. |
| Browser/live/deploy | **BLOCKED** | Not run or authorized. No provider request, remote migration, secret change, browser E2E session, or deployment occurred in this round. |

## Final review remediation

| Scope | Status | Evidence and boundary |
| --- | --- | --- |
| Safe failure codes | **PASS** | The runner now preserves all four bounded provider codes: `VIDEO_UNAVAILABLE`, `PROVIDER_TRANSIENT`, `PROVIDER_QUOTA`, and `PROVIDER_TIMEOUT`. Unknown exceptions still map to `PROVIDER_TRANSIENT`; no provider retry was added. |
| Nonblank AI output | **PASS** | Transcript title/text, generated readings, romanization, and Vietnamese meaning must contain a non-whitespace character in both response schema and runtime validation. Validation does not trim or rewrite accepted content; English casing, punctuation, and surrounding whitespace remain byte-for-byte unchanged. Invalid prepared output is failed before the completion RPC. |
| Import error recovery UI | **PASS** | Admission `DAILY_LIMIT` and `ACTIVE_LIMIT` messages include the server-provided wait in Vietnamese. Terminal unavailable/quota/timeout/transient/expiry states have distinct Vietnamese messages and an accessible link back to `/import` to create a new task. This is component evidence, not browser E2E evidence. |
| Boundary fixtures and repository correlation | **PASS** | The malformed UTF-8 test now sends raw `0xff`. `fail_import` accepts only the `null` response of its SQL `void` contract, and cached metadata must correlate to the requested YouTube video ID. |
| Fresh local verification | **PASS** | Focused regression run: 5 files, 124 tests, exit 0. Full suite: 25 files, 368 tests, exit 0. `npm run check:server`, `npm run build`, `npm run check:client-secrets`, and `git diff --check` all exited 0. Database tests were not rerun because this remediation did not change migrations, SQL, or database schema. |
| Browser/live/deploy | **BLOCKED** | No provider request, remote database action, credential read/change, browser E2E session, Vercel deployment, or production action occurred. Keep `IMPORT_ENABLED=false`. |

## Quality gate for the future live run

The private manifest must contain one pure-Korean, one pure-English, and three mixed Korean/English full songs, collectively covering rap, instrumental gaps, repeats, and at least one 6–8 minute video. A reviewer who understands the languages must prepare the full transcript and at least 20 cues across beginning/middle/end before model output is seen, and confirm retention rights.

Every one of ten independent runs must meet all of these: CER ≤5% per song; no omitted or hallucinated line; at least 90% of selected cues have both start and end within 0.5 seconds; no selected boundary exceeds 1 second; English literal copy is 100%; completion ≤240 seconds; output is not truncated. Record actual input/output/total tokens, finish reasons, and elapsed time. A language reviewer must also accept Korean pronunciation and Vietnamese meaning. Do not average away a failing song and do not drop unmatched cues.

The generated report deliberately says `featureMayBeEnabled: false` and marks both human reviews required. Only the owner may convert the overall gate after those reviews. Do not ask users to enter lyrics or timestamps manually to compensate for a failure.

## Production checklist after authorization

- Confirm the existing Vercel account, project, production domain, Node runtime, Fluid Compute entitlement, and observed 300-second/background behavior.
- Confirm trusted client IP extraction at actual ingress. If it cannot be established, keep access admission disabled.
- Confirm Production-only server variables, separate access/cron credentials, YouTube Data API restriction, Supabase Data API state, remote migration history, and effective backend/PUBLIC privileges.
- Run authorized maintenance, observe a fresh database heartbeat, test the >48-hour admission closure, and prove the external alert channel receives a forced failure.
- Run the full live benchmark and human review outside Git. Resolve the development-tool audit risk.
- Run the release chain, verify the returned URL, direct practice/import routes, API 404 behavior, cookie `Secure`/`HttpOnly`/`SameSite=Strict`/`Path=/api`, cron heartbeat, and only then consider enabling imports.

## Rollback

Set `IMPORT_ENABLED=false` to stop new imports. Keep daily maintenance, retention cleanup, metadata RLS/visibility, and existing manual/AI songs. Do not delete prior songs, reset the database, disable maintenance, or roll schema back merely to stop admissions. Rotate a compromised credential separately and keep the feature disabled until the affected gate has fresh evidence.
