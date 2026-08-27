// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readServerConfig } from '../../server/config';
import { createSession } from '../../server/access/session';
import { createImportHandler, createImportStatusHandler, type ImportHandlerDependencies } from '../../server/imports/handler';
import type { Lease } from '../../server/imports/types';
import { request, response } from './http-fixtures';

const token = 'A'.repeat(43);
const config = readServerConfig({ IMPORT_ACCESS_TOKEN: token, APP_ORIGIN: 'https://app.test', IMPORT_ENABLED: 'false' });
const enabledConfig = { ...config, importEnabled: true };
const cookie = `song_import_session=${createSession(token, 1000)}`;
const job = {
  jobId: '10000000-0000-4000-8000-000000000001',
  status: 'checking_video' as const,
  stage: 'checking_video' as const,
  deadlineAt: '2026-08-27T10:04:00.000Z',
};
const lease: Lease = { jobId: job.jobId, leaseToken: '20000000-0000-4000-8000-000000000002', deadlineAt: job.deadlineAt };

function setup(overrides: Partial<ImportHandlerDependencies> = {}) {
  const repository = {
    admit: vi.fn(async () => ({ kind: 'created' as const, job, lease })),
    getJob: vi.fn(async () => job),
    getVideoState: vi.fn(async () => null),
    advance: vi.fn(async () => true),
    fail: vi.fn(async () => undefined),
    complete: vi.fn(async () => '30000000-0000-4000-8000-000000000003'),
    completeCached: vi.fn(async () => '30000000-0000-4000-8000-000000000003'),
  };
  const background = vi.fn((_promise: Promise<unknown>) => undefined);
  const fetchVideo = vi.fn(async () => ({
    videoId: '1CTced9CMMk', title: 'Video', durationSeconds: 60,
    isPublic: true, embeddable: true, isLive: false, playable: true,
    fetchedAt: '1970-01-01T00:16:40.000Z', expiresAt: '1970-01-02T00:16:40.000Z',
  }));
  const transcribe = vi.fn(async () => ({ title: 'Song', lines: [{ text: 'English', start: 0, end: 2 }] }));
  const enrich = vi.fn(async () => ({ title: 'Song', lines: [{ text: 'English', start: 0, end: 2, vietHan: 'English', romanization: 'English', meaning: 'Tiếng Anh' }] }));
  const deps: ImportHandlerDependencies = {
    config: enabledConfig,
    repository,
    runnerDeps: { fetchVideo, transcribe, enrich, now: () => 1000_000 },
    background,
    nowSeconds: () => 1000,
    ...overrides,
  };
  return { deps, repository, background, fetchVideo, transcribe, enrich };
}

function importRequest(body = JSON.stringify({ youtubeUrl: 'https://youtu.be/1CTced9CMMk' }), headers = {}) {
  return request('POST', body, { cookie, ...headers });
}

describe('POST /api/imports handler', () => {
  it('rejects a missing cookie before parsing, admission, or provider side effects', async () => {
    const { deps, repository, fetchVideo, transcribe } = setup();
    const out = response();

    await createImportHandler(deps)(request('POST', '{', { cookie: undefined }), out.res);

    expect(out.status).toBe(401);
    expect(repository.admit).not.toHaveBeenCalled();
    expect(fetchVideo).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('guards origin and strict JSON schema before admission', async () => {
    const { deps, repository } = setup();
    const wrongOrigin = response();
    await createImportHandler(deps)(importRequest('{}', { origin: 'https://evil.test' }), wrongOrigin.res);
    expect(wrongOrigin.status).toBe(403);
    const invalid = response();
    await createImportHandler(deps)(importRequest('{"youtubeUrl":"https://youtu.be/1CTced9CMMk","extra":true}'), invalid.res);
    expect(invalid.status).toBe(400);
    expect(repository.admit).not.toHaveBeenCalled();
  });

  it('rejects a bad YouTube URL before admission without consuming quota', async () => {
    const { deps, repository } = setup();
    const out = response();

    await createImportHandler(deps)(importRequest(JSON.stringify({ youtubeUrl: 'https://example.com/video' })), out.res);

    expect(out.status).toBe(400);
    expect(out.json()).toEqual({ error: 'INVALID_YOUTUBE_URL' });
    expect(repository.admit).not.toHaveBeenCalled();
  });

  it('returns cached and existing admissions without scheduling work', async () => {
    const { deps, repository, background, fetchVideo } = setup();
    repository.admit
      .mockResolvedValueOnce({ kind: 'cached', songId: '30000000-0000-4000-8000-000000000003' })
      .mockResolvedValueOnce({ kind: 'existing', job: { ...job, status: 'enriching', stage: 'enriching' } });

    const cached = response(); await createImportHandler(deps)(importRequest(), cached.res);
    expect(cached.status).toBe(200);
    expect(cached.json()).toEqual({ songId: '30000000-0000-4000-8000-000000000003' });
    const existing = response(); await createImportHandler(deps)(importRequest(), existing.res);
    expect(existing.status).toBe(202);
    expect(existing.json()).toEqual({ jobId: job.jobId, status: 'enriching', statusUrl: `/api/imports/${job.jobId}` });
    expect(background).not.toHaveBeenCalled();
    expect(fetchVideo).not.toHaveBeenCalled();
  });

  it('registers exactly one created runner before returning 202', async () => {
    const { deps, repository, background } = setup();
    const out = response();

    await createImportHandler(deps)(importRequest(), out.res);

    expect(out.status).toBe(202);
    expect(out.json()).toEqual({ jobId: job.jobId, status: 'checking_video', statusUrl: `/api/imports/${job.jobId}` });
    expect(repository.admit).toHaveBeenCalledWith('1CTced9CMMk');
    expect(background).toHaveBeenCalledOnce();
    expect(background.mock.calls[0]![0]).toBeInstanceOf(Promise);
    await background.mock.calls[0]![0];
  });

  it('cancels a microtask-gated runner and fails the lease when background registration throws', async () => {
    const { deps, repository, fetchVideo } = setup({ background: () => { throw new Error('registration failed'); } });
    const out = response();

    await createImportHandler(deps)(importRequest(), out.res);

    expect(out.status).toBe(503);
    expect(out.json()).toEqual({ error: 'IMPORT_UNAVAILABLE' });
    expect(fetchVideo).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(lease, 'PROVIDER_TRANSIENT');
  });

  it.each([
    ['DAILY_LIMIT', 429, 61],
    ['ACTIVE_LIMIT', 429, 9],
    ['VIDEO_UNAVAILABLE', 422, undefined],
    ['IMPORT_UNAVAILABLE', 503, undefined],
    ['UNKNOWN_INTERNAL', 503, undefined],
  ] as const)('maps rejected admission %s to a safe response', async (code, status, retryAfterSeconds) => {
    const { deps, repository, background } = setup();
    repository.admit.mockResolvedValue({ kind: 'rejected', code, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) });
    const out = response();

    await createImportHandler(deps)(importRequest(), out.res);

    expect(out.status).toBe(status);
    expect(out.json()).toEqual({ error: code === 'UNKNOWN_INTERNAL' ? 'IMPORT_UNAVAILABLE' : code });
    expect(out.headers['retry-after']).toBe(retryAfterSeconds === undefined ? undefined : String(retryAfterSeconds));
    expect(background).not.toHaveBeenCalled();
  });

  it('keeps the feature disabled before URL parsing or admission', async () => {
    const { deps, repository } = setup({ config });
    const out = response();

    await createImportHandler(deps)(importRequest('{'), out.res);

    expect(out.status).toBe(503);
    expect(out.json()).toEqual({ error: 'IMPORT_UNAVAILABLE' });
    expect(repository.admit).not.toHaveBeenCalled();
  });

  it('returns method and no-store guards without provider work', async () => {
    const { deps, repository } = setup();
    const out = response();
    await createImportHandler(deps)(request('GET', '', { cookie }), out.res);
    expect(out.status).toBe(405);
    expect(out.headers.allow).toBe('POST');
    expect(out.headers['cache-control']).toBe('no-store');
    expect(repository.admit).not.toHaveBeenCalled();
  });
});

describe('GET /api/imports/:id handler', () => {
  it('authenticates before validating or looking up the ID', async () => {
    const { deps, repository } = setup();
    const out = response();
    const req = request('GET', '', { cookie: undefined });
    req.query = { id: 'not-a-uuid' };

    await createImportStatusHandler(deps)(req, out.res);

    expect(out.status).toBe(401);
    expect(repository.getJob).not.toHaveBeenCalled();
  });

  it.each([undefined, 'not-a-uuid', ['10000000-0000-4000-8000-000000000001']])('returns the same 404 after auth for an invalid or unknown ID %#', async (id) => {
    const { deps, repository } = setup();
    repository.getJob.mockResolvedValue(null);
    const out = response(); const req = request('GET', '', { cookie }); req.query = { id } as never;

    await createImportStatusHandler(deps)(req, out.res);

    expect(out.status).toBe(404);
    expect(out.json()).toEqual({ error: 'IMPORT_NOT_FOUND' });
    expect(repository.getJob).not.toHaveBeenCalled();
  });

  it('returns a safe expired public status with no lease or fake progress', async () => {
    const { deps, repository } = setup();
    repository.getJob.mockResolvedValue({ ...job, status: 'expired', stage: 'expired', errorCode: 'JOB_EXPIRED' });
    const out = response(); const req = request('GET', '', { cookie }); req.query = { id: job.jobId };

    await createImportStatusHandler(deps)(req, out.res);

    expect(out.status).toBe(200);
    expect(out.json()).toEqual({ ...job, status: 'expired', stage: 'expired', errorCode: 'JOB_EXPIRED' });
    expect(out.body).not.toContain('lease');
    expect(out.body).not.toContain('percent');
    expect(out.headers['cache-control']).toBe('no-store');
  });

  it('returns failed separately from an expired lease without exposing raw failure details', async () => {
    const { deps, repository } = setup();
    repository.getJob.mockResolvedValue({ ...job, status: 'failed', stage: 'failed', errorCode: 'PROVIDER_TRANSIENT' });
    const out = response(); const req = request('GET', '', { cookie }); req.query = { id: job.jobId };

    await createImportStatusHandler(deps)(req, out.res);

    expect(out.status).toBe(200);
    expect(out.json()).toEqual({ ...job, status: 'failed', stage: 'failed', errorCode: 'PROVIDER_TRANSIENT' });
    expect(out.body).not.toContain('JOB_EXPIRED');
    expect(out.body).not.toContain('raw');
  });

  it('reads status even when new imports are feature-gated off', async () => {
    const { deps, repository } = setup({ config });
    const out = response(); const req = request('GET', '', { cookie }); req.query = { id: job.jobId };
    await createImportStatusHandler(deps)(req, out.res);
    expect(out.status).toBe(200);
    expect(repository.getJob).toHaveBeenCalledWith(job.jobId);
  });

  it('rejects unsupported methods with GET Allow and no lookup', async () => {
    const { deps, repository } = setup();
    const out = response(); const req = request('POST', '{}', { cookie }); req.query = { id: job.jobId };
    await createImportStatusHandler(deps)(req, out.res);
    expect(out.status).toBe(405);
    expect(out.headers.allow).toBe('GET');
    expect(repository.getJob).not.toHaveBeenCalled();
  });
});
