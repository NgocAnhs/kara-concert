// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createImportRepository, IMPORT_PROMPT_VERSION } from '../../server/imports/repository';

type Reply = { data: unknown; error: unknown };

function rpcClient(replies: Reply[]) {
  const calls: Array<{ name: string; args: unknown }> = [];
  return {
    calls,
    client: {
      from() { throw new Error('unexpected table query'); },
      async rpc(name: string, args: unknown) {
        calls.push({ name, args });
        return replies.shift() ?? { data: null, error: null };
      },
    },
  };
}

const publicRow = {
  job_id: '10000000-0000-4000-8000-000000000001',
  status: 'checking_video',
  stage: 'checking_video',
  deadline_at: '2026-08-27T10:04:00.000Z',
  song_id: null,
  error_code: null,
};

describe('import repository', () => {
  it('records the Vietnamese-pronunciation prompt revision', () => {
    expect(IMPORT_PROMPT_VERSION).toBe('youtube-auto-import-v3');
  });

  it('maps a created admission while keeping the raw lease out of PublicJob', async () => {
    const mock = rpcClient([{ data: [{ kind: 'created', ...publicRow, lease_token: '20000000-0000-4000-8000-000000000002', retry_after_seconds: null }], error: null }]);
    const repository = createImportRepository(mock.client, { aiModel: 'gemini-test' });

    const admission = await repository.admit('1CTced9CMMk');

    expect(admission).toEqual({
      kind: 'created',
      job: {
        jobId: publicRow.job_id,
        status: 'checking_video',
        stage: 'checking_video',
        deadlineAt: publicRow.deadline_at,
      },
      lease: {
        jobId: publicRow.job_id,
        leaseToken: '20000000-0000-4000-8000-000000000002',
        deadlineAt: publicRow.deadline_at,
      },
    });
    expect(admission.kind === 'created' && admission.job).not.toHaveProperty('leaseToken');
    expect(mock.calls).toEqual([{ name: 'admit_import', args: { p_video_id: '1CTced9CMMk' } }]);
  });

  it('maps cached, existing, and rejected admissions', async () => {
    const mock = rpcClient([
      { data: [{ kind: 'cached', song_id: '30000000-0000-4000-8000-000000000003' }], error: null },
      { data: [{ kind: 'existing', ...publicRow }], error: null },
      { data: [{ kind: 'rejected', error_code: 'DAILY_LIMIT', retry_after_seconds: 60 }], error: null },
    ]);
    const repository = createImportRepository(mock.client, { aiModel: 'gemini-test' });
    await expect(repository.admit('aaaaaaaaaaa')).resolves.toEqual({ kind: 'cached', songId: '30000000-0000-4000-8000-000000000003' });
    await expect(repository.admit('bbbbbbbbbbb')).resolves.toEqual({ kind: 'existing', job: {
      jobId: publicRow.job_id, status: 'checking_video', stage: 'checking_video', deadlineAt: publicRow.deadline_at,
    } });
    await expect(repository.admit('ccccccccccc')).resolves.toEqual({ kind: 'rejected', code: 'DAILY_LIMIT', retryAfterSeconds: 60 });
  });

  it('rejects malformed database rows instead of exposing partial state', async () => {
    const mock = rpcClient([{ data: [{ kind: 'created', ...publicRow, lease_token: null }], error: null }]);
    const repository = createImportRepository(mock.client, { aiModel: 'gemini-test' });
    await expect(repository.admit('1CTced9CMMk')).rejects.toThrow('IMPORT_DATABASE_ERROR');
  });

  it('uses fenced stage, failure, and read RPCs and never converts DB errors to success', async () => {
    const lease = { jobId: publicRow.job_id, leaseToken: '20000000-0000-4000-8000-000000000002', deadlineAt: publicRow.deadline_at };
    const mock = rpcClient([
      { data: true, error: null },
      { data: null, error: { message: 'database unavailable' } },
      { data: null, error: null },
      { data: [publicRow], error: null },
    ]);
    const repository = createImportRepository(mock.client, { aiModel: 'gemini-test' });
    await expect(repository.advance(lease, 'transcribing')).resolves.toBe(true);
    await expect(repository.advance(lease, 'enriching')).rejects.toThrow('IMPORT_DATABASE_ERROR');
    await expect(repository.fail(lease, 'PROVIDER_TRANSIENT')).resolves.toBeUndefined();
    await expect(repository.getJob(lease.jobId)).resolves.toEqual({
      jobId: publicRow.job_id, status: 'checking_video', stage: 'checking_video', deadlineAt: publicRow.deadline_at,
    });
    expect(mock.calls.map((call) => call.name)).toEqual(['advance_import', 'advance_import', 'fail_import', 'read_import']);
  });

  it('stores a raw Gemini response through the job lease fence', async () => {
    const lease = { jobId: publicRow.job_id, leaseToken: '20000000-0000-4000-8000-000000000002', deadlineAt: publicRow.deadline_at };
    const response = { status: 'completed', steps: [{ type: 'model_output' }] };
    const mock = rpcClient([{ data: true, error: null }]);
    const repository = createImportRepository(mock.client, { aiModel: 'gemini-test' });

    await expect(repository.recordGeminiOutput(lease, 'enrichment', 200, response)).resolves.toBeUndefined();

    expect(mock.calls).toEqual([{ name: 'record_gemini_output', args: {
      p_job_id: lease.jobId,
      p_lease_token: lease.leaseToken,
      p_stage: 'enrichment',
      p_http_status: 200,
      p_response: response,
    } }]);
  });

  it.each([true, false, 0, '', [], {}])('rejects malformed fail_import response %#', async (data) => {
    const lease = { jobId: publicRow.job_id, leaseToken: '20000000-0000-4000-8000-000000000002', deadlineAt: publicRow.deadline_at };
    const mock = rpcClient([{ data, error: null }]);
    const repository = createImportRepository(mock.client, { aiModel: 'gemini-test' });

    await expect(repository.fail(lease, 'PROVIDER_TRANSIENT')).rejects.toThrow('IMPORT_DATABASE_ERROR');
  });

  it('adds server-owned provenance and rejects a stale completion', async () => {
    const lease = { jobId: publicRow.job_id, leaseToken: '20000000-0000-4000-8000-000000000002', deadlineAt: publicRow.deadline_at };
    const metadata = { videoId: '1CTced9CMMk', title: 'YouTube title', durationSeconds: 60, isPublic: true, embeddable: true, isLive: false, playable: true, fetchedAt: '2026-08-27T10:00:00.000Z', expiresAt: '2026-09-20T10:00:00.000Z' };
    const song = { title: 'AI title', lines: [{ text: '안녕 English', start: 0, end: 2, vietHan: 'an-nhơng English', romanization: 'annyeong English', meaning: 'Xin chào' }] };
    const mock = rpcClient([
      { data: '30000000-0000-4000-8000-000000000003', error: null },
      { data: null, error: null },
    ]);
    const repository = createImportRepository(mock.client, { aiModel: 'gemini-test' });
    await expect(repository.complete(lease, metadata, song)).resolves.toBe('30000000-0000-4000-8000-000000000003');
    expect(mock.calls[0]).toEqual({ name: 'complete_import', args: {
      p_job_id: lease.jobId, p_lease_token: lease.leaseToken, p_metadata: metadata,
      p_song: { ...song, aiModel: 'gemini-test', promptVersion: IMPORT_PROMPT_VERSION },
    } });
    await expect(repository.complete(lease, metadata, song)).rejects.toThrow('IMPORT_LEASE_LOST');
  });

  it('uses the fenced cached completion RPC without adding provenance to metadata', async () => {
    const lease = { jobId: publicRow.job_id, leaseToken: '20000000-0000-4000-8000-000000000002', deadlineAt: publicRow.deadline_at };
    const metadata = { videoId: '1CTced9CMMk', title: 'YouTube title', durationSeconds: 60, isPublic: true, embeddable: true, isLive: false, playable: true, fetchedAt: '2026-08-27T10:00:00.000Z', expiresAt: '2026-09-20T10:00:00.000Z' };
    const mock = rpcClient([{ data: '30000000-0000-4000-8000-000000000003', error: null }]);
    const repository = createImportRepository(mock.client, { aiModel: 'gemini-test' });

    await expect(repository.completeCached(lease, metadata)).resolves.toBe('30000000-0000-4000-8000-000000000003');
    expect(mock.calls[0]).toEqual({ name: 'complete_cached_import', args: {
      p_job_id: lease.jobId, p_lease_token: lease.leaseToken, p_metadata: metadata,
    } });
  });

  it('reads backend-only video state and maps private metadata', async () => {
    const tableReplies = [
      { data: { source: 'ai', status: 'published', needs_reprocess: false }, error: null },
      { data: { video_id: '1CTced9CMMk', title: 'YouTube title', duration_seconds: 60,
        is_public: true, embeddable: true, is_live: false, playable: true,
        fetched_at: '2026-08-27T10:00:00.000Z', expires_at: '2026-09-20T10:00:00.000Z' }, error: null },
    ];
    const tables: string[] = [];
    const client = {
      async rpc() { throw new Error('unexpected RPC'); },
      from(table: string) {
        tables.push(table);
        return { select() { return { eq() { return { async maybeSingle() { return tableReplies.shift(); } }; } }; } };
      },
    };
    const repository = createImportRepository(client, { aiModel: 'gemini-test' });

    await expect(repository.getVideoState('1CTced9CMMk')).resolves.toEqual({
      source: 'ai', status: 'published', needsReprocess: false,
      metadata: { videoId: '1CTced9CMMk', title: 'YouTube title', durationSeconds: 60,
        isPublic: true, embeddable: true, isLive: false, playable: true,
        fetchedAt: '2026-08-27T10:00:00.000Z', expiresAt: '2026-09-20T10:00:00.000Z' },
    });
    expect(tables).toEqual(['songs', 'youtube_metadata']);
  });

  it('rejects metadata returned for a different video ID', async () => {
    const tableReplies = [
      { data: { source: 'ai', status: 'published', needs_reprocess: false }, error: null },
      { data: { video_id: 'aaaaaaaaaaa', title: 'Wrong video', duration_seconds: 60,
        is_public: true, embeddable: true, is_live: false, playable: true,
        fetched_at: '2026-08-27T10:00:00.000Z', expires_at: '2026-09-20T10:00:00.000Z' }, error: null },
    ];
    const client = {
      async rpc() { throw new Error('unexpected RPC'); },
      from() { return { select() { return { eq() { return { async maybeSingle() { return tableReplies.shift(); } }; } }; } }; },
    };
    const repository = createImportRepository(client, { aiModel: 'gemini-test' });

    await expect(repository.getVideoState('1CTced9CMMk')).rejects.toThrow('IMPORT_DATABASE_ERROR');
  });

  it('requires a valid configured AI model before any RPC can be called', () => {
    const mock = rpcClient([]);
    expect(() => createImportRepository(mock.client, { aiModel: '' })).toThrow('CONFIG_UNAVAILABLE');
    expect(() => createImportRepository(mock.client, { aiModel: 'bad/model' })).toThrow('CONFIG_UNAVAILABLE');
    expect(mock.calls).toHaveLength(0);
  });
});
