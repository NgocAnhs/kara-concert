import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createImportRepository } from '../../server/imports/repository';

function localScratchUrl(raw: string | undefined): string {
  if (!raw) throw new Error('LOCAL_DB_REQUIRED');
  try {
    const url = new URL(raw);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || url.port !== '55322' || !/^\/import_jobs_test_[0-9a-f]{32}$/.test(url.pathname)
      || url.username !== 'postgres' || !url.password || url.search || url.hash) {
      throw new Error();
    }
    return url.toString();
  } catch {
    throw new Error('LOCAL_DB_REQUIRED');
  }
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('atomic import admission on real PostgreSQL connections', () => {
  let admin: pg.Pool;
  let backend: pg.Pool;
  const backendPids = new Set<number>();

  beforeAll(async () => {
    const connectionString = localScratchUrl(process.env.DB_TEST_URL);
    admin = new pg.Pool({ connectionString, max: 2, ssl: false, connectionTimeoutMillis: 5_000 });
    backend = new pg.Pool({ connectionString, max: 10, min: 2, ssl: false,
      connectionTimeoutMillis: 5_000, options: '-c role=service_role' });
    const clients = await Promise.all([backend.connect(), backend.connect()]);
    expect(new Set(clients.map((client) => client.processID)).size).toBe(2);
    clients.forEach((client) => client.release());
  });

  afterAll(async () => {
    await Promise.allSettled([backend?.end(), admin?.end()]);
  });

  beforeEach(async () => {
    await admin.query('delete from public.import_jobs');
    await admin.query("delete from public.youtube_metadata where video_id like 't5%' or video_id like 'q%'");
    await admin.query("delete from public.songs where youtube_video_id like 't5%' or youtube_video_id like 'q%'");
    await admin.query('update public.import_runtime set maintenance_completed_at=clock_timestamp(), maintenance_lease_token=null, maintenance_started_at=null, maintenance_deadline_at=null where id=1');
    backendPids.clear();
  });

  function repository() {
    const rpcClient = {
      from() { throw new Error('unexpected table query'); },
      async rpc(name: string, args: Record<string, unknown>) {
        const queries: Record<string, { sql: string; values: unknown[]; scalar?: string; void?: boolean }> = {
          admit_import: { sql: 'select pg_backend_pid() as backend_pid, value.* from public.admit_import($1) value', values: [args.p_video_id] },
          advance_import: { sql: 'select public.advance_import($1,$2,$3) as value', values: [args.p_job_id, args.p_lease_token, args.p_stage], scalar: 'value' },
          fail_import: { sql: 'select public.fail_import($1,$2,$3)', values: [args.p_job_id, args.p_lease_token, args.p_error_code], void: true },
          complete_import: { sql: 'select public.complete_import($1,$2,$3,$4) as value', values: [args.p_job_id, args.p_lease_token, args.p_metadata, args.p_song], scalar: 'value' },
          complete_cached_import: { sql: 'select public.complete_cached_import($1,$2,$3) as value', values: [args.p_job_id, args.p_lease_token, args.p_metadata], scalar: 'value' },
          read_import: { sql: 'select * from public.read_import($1)', values: [args.p_job_id] },
        };
        const query = queries[name];
        if (!query) return { data: null, error: new Error('unknown RPC') };
        try {
          const result = await backend.query(query.sql, query.values);
          for (const row of result.rows) if (typeof row.backend_pid === 'number') backendPids.add(row.backend_pid);
          if (query.void) return { data: null, error: null };
          if (query.scalar) return { data: plain(result.rows[0]?.[query.scalar] ?? null), error: null };
          return { data: plain(result.rows), error: null };
        } catch (error) {
          return { data: null, error };
        }
      },
    };
    return createImportRepository(rpcClient as never, { aiModel: 'gemini-test' });
  }

  it('admits ten simultaneous requests for one video as one created and nine existing', async () => {
    const repo = repository();
    const results = await Promise.all(Array.from({ length: 10 }, () => repo.admit('t5same00001')));

    expect(results.filter((result) => result.kind === 'created')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'existing')).toHaveLength(9);
    expect(new Set(results.flatMap((result) => result.kind === 'created' || result.kind === 'existing'
      ? [result.job.jobId] : [])).size).toBe(1);
    expect(backendPids.size).toBeGreaterThanOrEqual(2);
    const stored = await admin.query('select count(*)::int as jobs, (select count(*)::int from public.import_attempts) as attempts from public.import_jobs');
    expect(stored.rows[0]).toEqual({ jobs: 1, attempts: 1 });
  });

  it('never admits more than two different videos concurrently', async () => {
    const repo = repository();
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => repo.admit(`t5slot${String(index).padStart(5, '0')}`)));

    expect(results.filter((result) => result.kind === 'created')).toHaveLength(2);
    expect(results.filter((result) => result.kind === 'rejected' && result.code === 'ACTIVE_LIMIT')).toHaveLength(8);
    expect(backendPids.size).toBeGreaterThanOrEqual(2);
    const active = await admin.query("select count(*)::int as count from public.import_jobs where status in ('checking_video','transcribing','enriching')");
    expect(active.rows[0].count).toBe(2);
  });

  it('admits more than twenty completed attempts while returning cached and existing results', async () => {
    const repo = repository();
    for (let index = 0; index < 20; index += 1) {
      const admission = await repo.admit(`q${String(index).padStart(10, '0')}`);
      expect(admission.kind).toBe('created');
      if (admission.kind === 'created') await repo.fail(admission.lease, 'TEST_DONE');
    }
    const twentyFirstAdmission = await repo.admit('q0000000020');
    expect(twentyFirstAdmission.kind).toBe('created');
    if (twentyFirstAdmission.kind === 'created') await repo.fail(twentyFirstAdmission.lease, 'TEST_DONE');

    const cached = await admin.query("insert into public.songs(title,youtube_url,status,youtube_video_id,source) values ('cached','https://youtu.be/t5cache0001','published','t5cache0001','manual') returning id");
    await admin.query("insert into public.import_jobs(video_id,status,stage,lease_token,deadline_at) values ('t5exist0001','checking_video','checking_video',gen_random_uuid(),clock_timestamp()+interval '1 minute')");
    await expect(repo.admit('t5cache0001')).resolves.toEqual({ kind: 'cached', songId: cached.rows[0].id });
    await expect(repo.admit('t5exist0001')).resolves.toMatchObject({ kind: 'existing' });
    const attempts = await admin.query('select count(*)::int as count from public.import_attempts');
    expect(attempts.rows[0].count).toBe(21);
  });

  it('uses database time after a contended job lock to fence late completion', async () => {
    const repo = repository();
    const admission = await repo.admit('t5late00001');
    expect(admission.kind).toBe('created');
    if (admission.kind !== 'created') return;
    expect(await repo.advance(admission.lease, 'transcribing')).toBe(true);
    expect(await repo.advance(admission.lease, 'enriching')).toBe(true);

    const locker = await admin.connect();
    try {
      await locker.query('begin');
      await locker.query("update public.import_jobs set deadline_at=clock_timestamp()+interval '150 milliseconds' where id=$1", [admission.lease.jobId]);
      const observed = new Date();
      const completion = repo.complete(admission.lease, {
        videoId: 't5late00001', title: 'private metadata', durationSeconds: 60,
        isPublic: true, embeddable: true, isLive: false, playable: true,
        fetchedAt: observed.toISOString(), expiresAt: new Date(observed.getTime() + 25 * 86_400_000).toISOString(),
      }, { title: 'AI title', lines: [{ text: '안녕', vietHan: 'an-nhơng', romanization: 'annyeong', meaning: 'Xin chào', start: 0, end: 2 }] });
      const completionAssertion = expect(completion).rejects.toThrow('IMPORT_LEASE_LOST');
      await new Promise((resolve) => setTimeout(resolve, 250));
      await locker.query('commit');
      await completionAssertion;
    } finally {
      await locker.query('rollback').catch(() => undefined);
      locker.release();
    }
    const state = await admin.query('select status from public.import_jobs where id=$1', [admission.lease.jobId]);
    expect(state.rows[0].status).toBe('expired');
    const songs = await admin.query("select count(*)::int as count from public.songs where youtube_video_id='t5late00001'");
    expect(songs.rows[0].count).toBe(0);
  });

  it('does not let a stale maintenance response overwrite newer import metadata after a song lock', async () => {
    await admin.query("insert into public.songs(title,youtube_url,status,youtube_video_id,source) values ('AI title','https://youtu.be/t5race00001','published','t5race00001','ai')");
    await admin.query("insert into public.youtube_metadata(video_id,title,duration_seconds,is_public,embeddable,is_live,playable,fetched_at,expires_at) values ('t5race00001','old metadata',60,true,true,false,true,clock_timestamp()-interval '25 days',clock_timestamp()+interval '4 days')");
    const acquired = await backend.query('select * from public.begin_maintenance()');
    const maintenanceFetchedAt = new Date().toISOString();
    const locker = await admin.connect();
    try {
      await locker.query('begin');
      await locker.query("select id from public.songs where youtube_video_id='t5race00001' for update");
      const staleApply = backend.query('select public.apply_metadata_refresh($1,$2) as applied', [
        acquired.rows[0].lease_token,
        {
          videoId: 't5race00001', title: 'stale maintenance metadata', durationSeconds: 60,
          isPublic: true, embeddable: true, isLive: false, playable: true,
          fetchedAt: maintenanceFetchedAt,
          expiresAt: new Date(Date.parse(maintenanceFetchedAt) + 30 * 86_400_000).toISOString(),
        },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await locker.query("update public.youtube_metadata set title='new import metadata', fetched_at=clock_timestamp(), expires_at=clock_timestamp()+interval '30 days' where video_id='t5race00001'");
      await locker.query('commit');
      expect((await staleApply).rows[0].applied).toBe(false);
    } finally {
      await locker.query('rollback').catch(() => undefined);
      locker.release();
    }
    const stored = await admin.query("select title from public.youtube_metadata where video_id='t5race00001'");
    expect(stored.rows[0].title).toBe('new import metadata');
  });

  it('stops retention cleanup when a contended song lock outlives the maintenance lease', async () => {
    await admin.query("insert into public.songs(title,youtube_url,status,youtube_video_id,source) values ('AI title','https://youtu.be/t5lock00001','published','t5lock00001','ai')");
    await admin.query("insert into public.youtube_metadata(video_id,title,duration_seconds,is_public,embeddable,is_live,playable,fetched_at,expires_at) values ('t5lock00001','old metadata',60,true,true,false,false,clock_timestamp()-interval '30 days',clock_timestamp()-interval '29 days')");
    const acquired = await backend.query('select * from public.begin_maintenance()');
    await admin.query("update public.import_runtime set maintenance_deadline_at=clock_timestamp()+interval '150 milliseconds' where id=1");
    const locker = await admin.connect();
    try {
      await locker.query('begin');
      await locker.query("select id from public.songs where youtube_video_id='t5lock00001' for update");
      const cleanup = backend.query('select * from public.cleanup_import_data($1)', [acquired.rows[0].lease_token]);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const waiting = await admin.query("select count(*)::int as count from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select * from public.cleanup_import_data%'");
        if (waiting.rows[0].count > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (attempt === 19) throw new Error('MAINTENANCE_LOCK_NOT_OBSERVED');
      }
      await new Promise((resolve) => setTimeout(resolve, 175));
      await locker.query('commit');
      expect((await cleanup).rowCount).toBe(0);
    } finally {
      await locker.query('rollback').catch(() => undefined);
      locker.release();
    }
    const retained = await admin.query("select count(*)::int as count from public.youtube_metadata where video_id='t5lock00001'");
    expect(retained.rows[0].count).toBe(1);
  });
});
