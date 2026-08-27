// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMaintenanceHandler, runMaintenance, type MaintenanceDependencies } from '../../server/maintenance';
import { ProviderFailure } from '../../server/imports/youtube';
import { createSession } from '../../server/access/session';
import { request, response } from './http-fixtures';

const lease = {
  leaseToken: '10000000-0000-4000-8000-000000000001',
  deadlineAt: new Date(60_000).toISOString(),
};
const metadata = (videoId: string, durationSeconds = 200) => ({
  videoId,
  title: `YouTube ${videoId}`,
  durationSeconds,
  isPublic: true,
  embeddable: true,
  isLive: false,
  playable: true,
  fetchedAt: new Date(1_000).toISOString(),
  expiresAt: new Date(1_000 + 30 * 24 * 60 * 60 * 1000).toISOString(),
});

function dependencies(overrides: Partial<MaintenanceDependencies> = {}): MaintenanceDependencies {
  return {
    beginMaintenance: vi.fn().mockResolvedValue(lease),
    cleanupImportData: vi.fn().mockResolvedValue(['aaaaaaaaaaa', 'bbbbbbbbbbb']),
    applyMetadataRefresh: vi.fn().mockResolvedValue(true),
    markMetadataUnavailable: vi.fn().mockResolvedValue(true),
    finishMaintenance: vi.fn().mockResolvedValue(true),
    fetchVideo: vi.fn(async (videoId) => metadata(videoId)),
    now: vi.fn(() => 0),
    ...overrides,
  };
}

afterEach(() => vi.useRealTimers());

describe('maintenance runner', () => {
  it('cleans before provider calls, refreshes the bounded batch, then completes the heartbeat', async () => {
    const events: string[] = [];
    const deps = dependencies({
      cleanupImportData: vi.fn(async () => { events.push('cleanup'); return ['aaaaaaaaaaa']; }),
      fetchVideo: vi.fn(async (videoId) => { events.push('provider'); return metadata(videoId); }),
      applyMetadataRefresh: vi.fn(async () => { events.push('apply'); return true; }),
      finishMaintenance: vi.fn(async () => { events.push('finish'); return true; }),
    });

    await runMaintenance(deps);

    expect(events).toEqual(['cleanup', 'provider', 'apply', 'finish']);
    expect(deps.applyMetadataRefresh).toHaveBeenCalledWith(lease.leaseToken, metadata('aaaaaaaaaaa'));
  });

  it('treats a concurrent lease as a successful no-op without cleanup or provider work', async () => {
    const deps = dependencies({ beginMaintenance: vi.fn().mockResolvedValue(null) });
    await runMaintenance(deps);
    expect(deps.cleanupImportData).not.toHaveBeenCalled();
    expect(deps.fetchVideo).not.toHaveBeenCalled();
    expect(deps.finishMaintenance).not.toHaveBeenCalled();
  });

  it('marks only known unavailable videos and never calls Gemini', async () => {
    const deps = dependencies({
      cleanupImportData: vi.fn().mockResolvedValue(['aaaaaaaaaaa']),
      fetchVideo: vi.fn().mockRejectedValue(new ProviderFailure('VIDEO_UNAVAILABLE')),
    });
    await runMaintenance(deps);
    expect(deps.markMetadataUnavailable).toHaveBeenCalledWith(lease.leaseToken, 'aaaaaaaaaaa');
    expect(deps.applyMetadataRefresh).not.toHaveBeenCalled();
  });

  it('does not mark transient failures unavailable or update the heartbeat', async () => {
    const deps = dependencies({
      cleanupImportData: vi.fn().mockResolvedValue(['aaaaaaaaaaa']),
      fetchVideo: vi.fn().mockRejectedValue(new ProviderFailure('PROVIDER_TRANSIENT')),
    });
    await expect(runMaintenance(deps)).rejects.toThrow('MAINTENANCE_INCOMPLETE');
    expect(deps.markMetadataUnavailable).not.toHaveBeenCalled();
    expect(deps.finishMaintenance).not.toHaveBeenCalled();
  });

  it('does not report a heartbeat after the lease budget is exhausted', async () => {
    const deps = dependencies({ now: vi.fn(() => 60_000) });
    await expect(runMaintenance(deps)).rejects.toThrow('MAINTENANCE_INCOMPLETE');
    expect(deps.fetchVideo).not.toHaveBeenCalled();
    expect(deps.finishMaintenance).not.toHaveBeenCalled();
  });

  it('aborts a provider call at 15 seconds even when more lease time remains', async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    const deps = dependencies({
      cleanupImportData: vi.fn().mockResolvedValue(['aaaaaaaaaaa']),
      fetchVideo: vi.fn((_videoId, { signal }) => {
        receivedSignal = signal;
        return new Promise((_, reject) => signal.addEventListener('abort', () => {
          reject(new ProviderFailure('PROVIDER_TRANSIENT'));
        }, { once: true }));
      }),
    });
    const runner = runMaintenance(deps);
    const outcome = runner.then(() => undefined, (error: unknown) => error);

    try {
      await vi.advanceTimersByTimeAsync(14_999);
      expect(receivedSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(receivedSignal?.aborted).toBe(true);
      expect(await outcome).toMatchObject({ message: 'MAINTENANCE_INCOMPLETE' });
    } finally {
      await vi.runAllTimersAsync();
      await outcome;
    }
  });

  it('clears the provider timer after a completed request', async () => {
    vi.useFakeTimers();
    const deps = dependencies({ cleanupImportData: vi.fn().mockResolvedValue(['aaaaaaaaaaa']) });

    await runMaintenance(deps);

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('maintenance cron handler', () => {
  it.each([undefined, 'Bearer wrong-secret', 'Basic cron-secret'])('rejects missing or invalid cron authorization before side effects', async (authorization) => {
    const run = vi.fn();
    const handler = createMaintenanceHandler({ cronSecret: 'cron-secret', run });
    const out = response();
    await handler(request('GET', '', { authorization }), out.res);
    expect(out.status).toBe(401);
    expect(out.headers['cache-control']).toBe('no-store');
    expect(run).not.toHaveBeenCalled();
  });

  it('does not accept an import session cookie as cron authority', async () => {
    const run = vi.fn();
    const handler = createMaintenanceHandler({ cronSecret: 'cron-secret', run });
    const session = createSession('A'.repeat(43), 1_000);
    const out = response();
    await handler(request('GET', '', { cookie: `song_import_session=${session}`, authorization: undefined }), out.res);
    expect(out.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('runs without browser Origin or JSON headers when the bearer secret matches', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const handler = createMaintenanceHandler({ cronSecret: 'cron-secret', run });
    const out = response();
    await handler(request('GET', '', {
      authorization: 'Bearer cron-secret', origin: undefined, 'content-type': undefined,
    }), out.res);
    expect(out.status).toBe(200);
    expect(out.json()).toEqual({ ok: true });
    expect(run).toHaveBeenCalledOnce();
  });

  it('returns a safe operational error and no false success when maintenance is incomplete', async () => {
    const handler = createMaintenanceHandler({
      cronSecret: 'cron-secret', run: vi.fn().mockRejectedValue(new Error('provider detail and secret')),
    });
    const out = response();
    await handler(request('GET', '', { authorization: 'Bearer cron-secret' }), out.res);
    expect(out.status).toBe(503);
    expect(out.json()).toEqual({ error: 'MAINTENANCE_UNAVAILABLE' });
    expect(out.body).not.toContain('provider detail');
  });
});
