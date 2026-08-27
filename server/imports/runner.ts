import { validatePreparedSong } from './gemini.js';
import type { ImportRepository, VideoState } from './repository.js';
import type { Lease, PreparedSong, Transcript, VideoMetadata } from './types.js';
import { ProviderFailure, type ProviderFailureCode } from './youtube.js';

type CallOptions = { signal: AbortSignal };
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export type ImportRunnerDependencies = {
  repository: Pick<ImportRepository, 'advance' | 'fail' | 'complete' | 'completeCached' | 'getVideoState'>;
  fetchVideo: (videoId: string, options: CallOptions) => Promise<VideoMetadata>;
  transcribe: (canonicalUrl: string, options: CallOptions) => Promise<Transcript>;
  enrich: (transcript: Transcript, options: CallOptions) => Promise<PreparedSong>;
  now?: () => number;
};

class DeadlineReached extends Error {}

function repositoryFailure(error: unknown): 'database' | 'lease' | null {
  if (!(error instanceof Error)) return null;
  if (error.message === 'IMPORT_DATABASE_ERROR') return 'database';
  if (error.message === 'IMPORT_LEASE_LOST') return 'lease';
  return null;
}

function safeFailureCode(error: unknown): ProviderFailureCode {
  return error instanceof ProviderFailure ? error.code : 'PROVIDER_TRANSIENT';
}

function assertBudget(now: () => number, deadlineAt: number, signal: AbortSignal): void {
  if (signal.aborted || now() >= deadlineAt) throw new DeadlineReached();
}

function canCompleteCached(state: VideoState | null, current: VideoMetadata, videoId: string): boolean {
  return state?.source === 'ai'
    && state.status === 'published'
    && !state.needsReprocess
    && state.metadata !== null
    && state.metadata.videoId === videoId
    && current.videoId === videoId
    && state.metadata.durationSeconds === current.durationSeconds;
}

async function fetchMetadata(
  videoId: string,
  fetchVideo: ImportRunnerDependencies['fetchVideo'],
  commonSignal: AbortSignal,
  now: () => number,
  deadlineAt: number,
): Promise<VideoMetadata> {
  assertBudget(now, deadlineAt, commonSignal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  commonSignal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, Math.min(15_000, Math.max(0, deadlineAt - now())));
  try {
    return await fetchVideo(videoId, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    commonSignal.removeEventListener('abort', abort);
  }
}

export async function runImport(lease: Lease, videoId: string, deps: ImportRunnerDependencies): Promise<void> {
  const now = deps.now ?? Date.now;
  const deadlineAt = Date.parse(lease.deadlineAt);
  const controller = new AbortController();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    if (!Number.isFinite(deadlineAt)) throw new DeadlineReached();
    assertBudget(now, deadlineAt, controller.signal);
    deadlineTimer = setTimeout(
      () => controller.abort(),
      Math.min(MAX_TIMER_DELAY_MS, Math.max(0, deadlineAt - now())),
    );

    const metadata = await fetchMetadata(videoId, deps.fetchVideo, controller.signal, now, deadlineAt);
    assertBudget(now, deadlineAt, controller.signal);

    const state = await deps.repository.getVideoState(videoId);
    assertBudget(now, deadlineAt, controller.signal);
    if (canCompleteCached(state, metadata, videoId)) {
      await deps.repository.completeCached(lease, metadata);
      return;
    }

    if (!await deps.repository.advance(lease, 'transcribing')) return;
    assertBudget(now, deadlineAt, controller.signal);

    const transcript = await deps.transcribe(`https://www.youtube.com/watch?v=${videoId}`, { signal: controller.signal });
    assertBudget(now, deadlineAt, controller.signal);

    if (!await deps.repository.advance(lease, 'enriching')) return;
    assertBudget(now, deadlineAt, controller.signal);

    const enriched = await deps.enrich(transcript, { signal: controller.signal });
    assertBudget(now, deadlineAt, controller.signal);
    const prepared = validatePreparedSong(enriched, metadata.durationSeconds);
    assertBudget(now, deadlineAt, controller.signal);
    await deps.repository.complete(lease, metadata, prepared);
  } catch (error) {
    if (repositoryFailure(error)) return;
    try {
      await deps.repository.fail(lease, safeFailureCode(error));
    } catch {
      // The database lease is the final reclamation path when failure storage is unavailable.
    }
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    controller.abort();
  }
}
