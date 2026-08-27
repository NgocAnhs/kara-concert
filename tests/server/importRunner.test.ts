// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runImport, type ImportRunnerDependencies } from '../../server/imports/runner';
import { ProviderFailure } from '../../server/imports/youtube';
import type { Lease, PreparedSong, Transcript, VideoMetadata } from '../../server/imports/types';

const START = Date.parse('2026-08-27T10:00:00.000Z');
const VIDEO_ID = '1CTced9CMMk';
const lease: Lease = {
  jobId: '10000000-0000-4000-8000-000000000001',
  leaseToken: '20000000-0000-4000-8000-000000000002',
  deadlineAt: new Date(START + 240_000).toISOString(),
};
const metadata: VideoMetadata = {
  videoId: VIDEO_ID,
  title: 'YouTube title',
  durationSeconds: 60,
  isPublic: true,
  embeddable: true,
  isLive: false,
  playable: true,
  fetchedAt: new Date(START + 100).toISOString(),
  expiresAt: new Date(START + 86_400_000).toISOString(),
};
const transcript: Transcript = {
  title: 'Song title',
  lines: [{ text: '안녕 English', start: 0, end: 2 }],
};
const prepared: PreparedSong = {
  title: 'Song title',
  lines: [{ ...transcript.lines[0]!, vietHan: 'an-nhơng English', romanization: 'annyeong English', meaning: 'Xin chào' }],
};

function setup(overrides: Partial<ImportRunnerDependencies> = {}) {
  const order: string[] = [];
  const repository = {
    admit: vi.fn(),
    getJob: vi.fn(),
    getVideoState: vi.fn(async () => null),
    advance: vi.fn(async (_lease: Lease, stage: string) => { order.push(`advance:${stage}`); return true; }),
    fail: vi.fn(async (_lease: Lease, code: string) => { order.push(`fail:${code}`); }),
    complete: vi.fn(async () => { order.push('complete'); return '30000000-0000-4000-8000-000000000003'; }),
    completeCached: vi.fn(async () => { order.push('completeCached'); return '30000000-0000-4000-8000-000000000003'; }),
  };
  const deps: ImportRunnerDependencies = {
    repository,
    fetchVideo: vi.fn(async () => { order.push('metadata'); return metadata; }),
    transcribe: vi.fn(async () => { order.push('transcribe'); return transcript; }),
    enrich: vi.fn(async () => { order.push('enrich'); return prepared; }),
    now: () => START,
    ...overrides,
  };
  return { deps, repository, order };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('import runner', () => {
  it('runs the one-way full pipeline and completes only after validated enrichment', async () => {
    const { deps, repository, order } = setup();

    await expect(runImport(lease, VIDEO_ID, deps)).resolves.toBeUndefined();

    expect(order).toEqual(['metadata', 'advance:transcribing', 'transcribe', 'advance:enriching', 'enrich', 'complete']);
    expect(repository.complete).toHaveBeenCalledWith(lease, metadata, prepared);
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it('uses the cached shortcut only after metadata revalidation against a safe baseline', async () => {
    const { deps, repository, order } = setup();
    repository.getVideoState.mockResolvedValue({ source: 'ai', status: 'published', needsReprocess: false, metadata: { ...metadata, fetchedAt: new Date(START - 1000).toISOString() } });

    await runImport(lease, VIDEO_ID, deps);

    expect(order).toEqual(['metadata', 'completeCached']);
    expect(repository.advance).not.toHaveBeenCalled();
    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(deps.enrich).not.toHaveBeenCalled();
  });

  it.each([
    { source: 'manual' as const, status: 'published' as const, needsReprocess: false, metadata },
    { source: 'ai' as const, status: 'draft' as const, needsReprocess: false, metadata },
    { source: 'ai' as const, status: 'published' as const, needsReprocess: true, metadata },
    { source: 'ai' as const, status: 'published' as const, needsReprocess: false, metadata: null },
    { source: 'ai' as const, status: 'published' as const, needsReprocess: false, metadata: { ...metadata, durationSeconds: 61 } },
  ])('does not guess that an unsafe cache can reuse old timing %#', async (state) => {
    const { deps, repository } = setup();
    repository.getVideoState.mockResolvedValue(state);

    await runImport(lease, VIDEO_ID, deps);

    expect(repository.completeCached).not.toHaveBeenCalled();
    expect(repository.complete).toHaveBeenCalledOnce();
  });

  it.each([
    [new ProviderFailure('VIDEO_UNAVAILABLE'), 'VIDEO_UNAVAILABLE'],
    [new ProviderFailure('PROVIDER_TRANSIENT'), 'PROVIDER_TRANSIENT'],
    [new ProviderFailure('PROVIDER_QUOTA'), 'PROVIDER_QUOTA'],
    [new ProviderFailure('PROVIDER_TIMEOUT'), 'PROVIDER_TIMEOUT'],
    [new Error('raw provider details'), 'PROVIDER_TRANSIENT'],
  ])('maps provider failure safely without retrying %#', async (failure, code) => {
    const fetchVideo = vi.fn(async () => { throw failure; });
    const { deps, repository } = setup({ fetchVideo });

    await expect(runImport(lease, VIDEO_ID, deps)).resolves.toBeUndefined();

    expect(fetchVideo).toHaveBeenCalledOnce();
    expect(repository.fail).toHaveBeenCalledWith(lease, code);
    expect(deps.transcribe).not.toHaveBeenCalled();
  });

  it('fails safely when transcription rejects without retrying or enriching', async () => {
    const transcribe = vi.fn(async () => { throw new Error('raw transcription failure'); });
    const { deps, repository } = setup({ transcribe });

    await runImport(lease, VIDEO_ID, deps);

    expect(transcribe).toHaveBeenCalledOnce();
    expect(deps.enrich).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(lease, 'PROVIDER_TRANSIENT');
  });

  it('fails safely when enrichment rejects without retrying or completing', async () => {
    const enrich = vi.fn(async () => { throw new Error('raw enrichment failure'); });
    const { deps, repository } = setup({ enrich });

    await runImport(lease, VIDEO_ID, deps);

    expect(enrich).toHaveBeenCalledOnce();
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(lease, 'PROVIDER_TRANSIENT');
  });

  it('rejects malformed prepared data before the completion RPC', async () => {
    const { deps, repository } = setup({
      enrich: vi.fn(async () => ({ ...prepared, lines: [{ ...prepared.lines[0]!, end: 61 }] })),
    });

    await runImport(lease, VIDEO_ID, deps);

    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(lease, 'PROVIDER_TRANSIENT');
  });

  it.each([
    { ...prepared, title: '   ' },
    { ...prepared, lines: [{ ...prepared.lines[0]!, text: '\t' }] },
    { ...prepared, lines: [{ ...prepared.lines[0]!, vietHan: '\n' }] },
    { ...prepared, lines: [{ ...prepared.lines[0]!, romanization: '  ' }] },
    { ...prepared, lines: [{ ...prepared.lines[0]!, meaning: '\t' }] },
  ])('terminally fails blank model output before calling the completion RPC %#', async (malformed) => {
    const { deps, repository } = setup({ enrich: vi.fn(async () => malformed) });

    await runImport(lease, VIDEO_ID, deps);

    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(lease, 'PROVIDER_TRANSIENT');
  });

  it.each(['transcribing', 'enriching'] as const)('stops quietly when the %s stage CAS loses its lease', async (staleStage) => {
    const { deps, repository } = setup();
    repository.advance.mockImplementation(async (_lease: Lease, stage: string) => stage !== staleStage);

    await runImport(lease, VIDEO_ID, deps);

    expect(repository.fail).not.toHaveBeenCalled();
    if (staleStage === 'transcribing') expect(deps.transcribe).not.toHaveBeenCalled();
    else expect(deps.enrich).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it('stops quietly when a stale worker loses the lease at completion', async () => {
    const { deps, repository } = setup();
    repository.complete.mockRejectedValue(new Error('IMPORT_LEASE_LOST'));

    await expect(runImport(lease, VIDEO_ID, deps)).resolves.toBeUndefined();

    expect(repository.fail).not.toHaveBeenCalled();
  });

  it('lets a database failure expire through the lease instead of misreporting a provider failure', async () => {
    const { deps, repository } = setup();
    repository.advance.mockRejectedValue(new Error('IMPORT_DATABASE_ERROR'));

    await expect(runImport(lease, VIDEO_ID, deps)).resolves.toBeUndefined();

    expect(repository.fail).not.toHaveBeenCalled();
  });

  it('contains a best-effort failure write rejection', async () => {
    const { deps, repository } = setup({ fetchVideo: vi.fn(async () => { throw new Error('provider raw'); }) });
    repository.fail.mockRejectedValue(new Error('database unavailable'));

    await expect(runImport(lease, VIDEO_ID, deps)).resolves.toBeUndefined();
  });

  it('aborts metadata at 15 seconds without starting another step', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const fetchVideo = vi.fn((_videoId: string, { signal }: { signal: AbortSignal }) => new Promise<VideoMetadata>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new ProviderFailure('PROVIDER_TRANSIENT')), { once: true });
    }));
    const { deps, repository } = setup({ fetchVideo, now: () => Date.now() });

    const running = runImport(lease, VIDEO_ID, deps);
    await vi.advanceTimersByTimeAsync(15_000);
    await running;

    expect(fetchVideo).toHaveBeenCalledOnce();
    expect(repository.fail).toHaveBeenCalledWith(lease, 'PROVIDER_TRANSIENT');
    expect(repository.getVideoState).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps scheduled delays at the largest value Node timers support', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const distantLease = { ...lease, deadlineAt: '2100-01-01T00:00:00.000Z' };
    const { deps } = setup({ now: () => Date.now() });

    await runImport(distantLease, VIDEO_ID, deps);

    expect(setTimeoutSpy.mock.calls.map(([, delay]) => delay)).toEqual([2_147_483_647, 15_000]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    'before-metadata', 'after-metadata', 'after-state', 'after-transcribing-cas',
    'after-transcript', 'after-enriching-cas', 'after-enrichment',
  ])('does not start the next step at the absolute deadline: %s', async (boundary) => {
    let current = boundary === 'before-metadata' ? START + 240_000 : START;
    const { deps, repository } = setup({ now: () => current });
    if (boundary === 'after-metadata') vi.mocked(deps.fetchVideo).mockImplementation(async () => { current = START + 240_000; return metadata; });
    if (boundary === 'after-state') repository.getVideoState.mockImplementation(async () => { current = START + 240_000; return null; });
    if (boundary === 'after-transcribing-cas') repository.advance.mockImplementation(async (_lease: Lease, stage: string) => { if (stage === 'transcribing') current = START + 240_000; return true; });
    if (boundary === 'after-transcript') vi.mocked(deps.transcribe).mockImplementation(async () => { current = START + 240_000; return transcript; });
    if (boundary === 'after-enriching-cas') repository.advance.mockImplementation(async (_lease: Lease, stage: string) => { if (stage === 'enriching') current = START + 240_000; return true; });
    if (boundary === 'after-enrichment') vi.mocked(deps.enrich).mockImplementation(async () => { current = START + 240_000; return prepared; });

    await runImport(lease, VIDEO_ID, deps);

    expect(repository.fail).toHaveBeenCalledWith(lease, 'PROVIDER_TRANSIENT');
    if (boundary === 'before-metadata') expect(deps.fetchVideo).not.toHaveBeenCalled();
    if (boundary === 'after-metadata') expect(repository.getVideoState).not.toHaveBeenCalled();
    if (boundary === 'after-state') expect(repository.advance).not.toHaveBeenCalled();
    if (boundary === 'after-transcribing-cas') expect(deps.transcribe).not.toHaveBeenCalled();
    if (boundary === 'after-transcript') expect(repository.advance).toHaveBeenCalledTimes(1);
    if (boundary === 'after-enriching-cas') expect(deps.enrich).not.toHaveBeenCalled();
    if (boundary === 'after-enrichment') expect(repository.complete).not.toHaveBeenCalled();
  });
});
