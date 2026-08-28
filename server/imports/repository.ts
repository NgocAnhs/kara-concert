import type { SupabaseClient } from '@supabase/supabase-js';
import type { PublicJob, JobStatus } from '../../shared/import.js';
import type { Lease, PreparedSong, VideoMetadata } from './types.js';
import type { GeminiStage } from './gemini.js';

export const IMPORT_PROMPT_VERSION = 'youtube-auto-import-v2';

export type Admission =
  | { kind: 'cached'; songId: string }
  | { kind: 'existing'; job: PublicJob }
  | { kind: 'created'; job: PublicJob; lease: Lease }
  | { kind: 'rejected'; code: string; retryAfterSeconds?: number };

export type VideoState = {
  source: 'manual' | 'ai';
  status: 'draft' | 'published';
  needsReprocess: boolean;
  metadata: VideoMetadata | null;
};

type RepositoryConfig = { aiModel: string };
type DatabaseClient = Pick<SupabaseClient, 'rpc' | 'from'>;
type RecordValue = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const MODEL = /^[A-Za-z0-9._-]{1,128}$/;
const STATUSES = new Set<JobStatus>(['checking_video', 'transcribing', 'enriching', 'completed', 'failed', 'expired']);

function databaseError(): never { throw new Error('IMPORT_DATABASE_ERROR'); }
function leaseLost(): never { throw new Error('IMPORT_LEASE_LOST'); }
function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}
function one(value: unknown): RecordValue | null {
  if (Array.isArray(value)) return value.length === 1 ? record(value[0]) : null;
  return record(value);
}
function nullableString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return typeof value === 'string' ? value : databaseError();
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) databaseError();
  return value;
}
function iso(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) databaseError();
  return value;
}
function status(value: unknown): JobStatus {
  if (typeof value !== 'string' || !STATUSES.has(value as JobStatus)) databaseError();
  return value as JobStatus;
}
function publicJob(row: RecordValue): PublicJob {
  const result: PublicJob = {
    jobId: uuid(row.job_id),
    status: status(row.status),
    stage: status(row.stage),
    deadlineAt: iso(row.deadline_at),
  };
  const songId = nullableString(row.song_id);
  const errorCode = nullableString(row.error_code);
  if (songId !== undefined) result.songId = uuid(songId);
  if (errorCode !== undefined) {
    if (!ERROR_CODE.test(errorCode)) databaseError();
    result.errorCode = errorCode;
  }
  return result;
}
function rpcData(data: unknown, error: unknown): unknown {
  if (error) databaseError();
  return data;
}

function metadataFromRow(value: unknown): VideoMetadata {
  const row = record(value);
  if (!row || typeof row.video_id !== 'string' || !VIDEO_ID.test(row.video_id)
    || typeof row.title !== 'string' || typeof row.duration_seconds !== 'number'
    || !Number.isInteger(row.duration_seconds) || typeof row.is_public !== 'boolean'
    || typeof row.embeddable !== 'boolean' || typeof row.is_live !== 'boolean'
    || typeof row.playable !== 'boolean') databaseError();
  return {
    videoId: row.video_id,
    title: row.title,
    durationSeconds: row.duration_seconds,
    isPublic: row.is_public,
    embeddable: row.embeddable,
    isLive: row.is_live,
    playable: row.playable,
    fetchedAt: iso(row.fetched_at),
    expiresAt: iso(row.expires_at),
  };
}

export function createImportRepository(client: DatabaseClient, { aiModel }: RepositoryConfig) {
  if (!client || typeof client.rpc !== 'function' || typeof client.from !== 'function'
    || !MODEL.test(aiModel)) throw new Error('CONFIG_UNAVAILABLE');

  async function admit(videoId: string): Promise<Admission> {
    if (!VIDEO_ID.test(videoId)) throw new Error('INVALID_VIDEO_ID');
    const result = await client.rpc('admit_import', { p_video_id: videoId });
    const row = one(rpcData(result.data, result.error));
    if (!row || typeof row.kind !== 'string') databaseError();
    if (row.kind === 'cached') return { kind: 'cached', songId: uuid(row.song_id) };
    if (row.kind === 'existing') return { kind: 'existing', job: publicJob(row) };
    if (row.kind === 'created') {
      const job = publicJob(row);
      return { kind: 'created', job, lease: {
        jobId: job.jobId, leaseToken: uuid(row.lease_token), deadlineAt: job.deadlineAt,
      } };
    }
    if (row.kind === 'rejected' && typeof row.error_code === 'string' && ERROR_CODE.test(row.error_code)) {
      const retry = row.retry_after_seconds;
      if (retry !== null && retry !== undefined && (!Number.isInteger(retry) || (retry as number) < 1)) databaseError();
      return { kind: 'rejected', code: row.error_code,
        ...(retry === null || retry === undefined ? {} : { retryAfterSeconds: retry as number }) };
    }
    return databaseError();
  }

  async function advance(lease: Lease, nextStage: 'transcribing' | 'enriching'): Promise<boolean> {
    const result = await client.rpc('advance_import', {
      p_job_id: lease.jobId, p_lease_token: lease.leaseToken, p_stage: nextStage,
    });
    const data = rpcData(result.data, result.error);
    if (typeof data !== 'boolean') databaseError();
    return data;
  }

  async function fail(lease: Lease, errorCode: string): Promise<void> {
    if (!ERROR_CODE.test(errorCode)) throw new Error('INVALID_ERROR_CODE');
    const result = await client.rpc('fail_import', {
      p_job_id: lease.jobId, p_lease_token: lease.leaseToken, p_error_code: errorCode,
    });
    const data = rpcData(result.data, result.error);
    if (data !== null) databaseError();
  }

  async function recordGeminiOutput(
    lease: Lease,
    stage: GeminiStage,
    httpStatus: number,
    response: unknown,
  ): Promise<void> {
    const result = await client.rpc('record_gemini_output', {
      p_job_id: lease.jobId,
      p_lease_token: lease.leaseToken,
      p_stage: stage,
      p_http_status: httpStatus,
      p_response: response,
    });
    const data = rpcData(result.data, result.error);
    if (data === false) return leaseLost();
    if (data !== true) databaseError();
  }

  async function complete(lease: Lease, metadata: VideoMetadata, prepared: PreparedSong): Promise<string> {
    const result = await client.rpc('complete_import', {
      p_job_id: lease.jobId,
      p_lease_token: lease.leaseToken,
      p_metadata: metadata,
      p_song: { ...prepared, aiModel, promptVersion: IMPORT_PROMPT_VERSION },
    });
    const data = rpcData(result.data, result.error);
    if (data === null) return leaseLost();
    return uuid(data);
  }

  async function completeCached(lease: Lease, metadata: VideoMetadata): Promise<string> {
    const result = await client.rpc('complete_cached_import', {
      p_job_id: lease.jobId, p_lease_token: lease.leaseToken, p_metadata: metadata,
    });
    const data = rpcData(result.data, result.error);
    if (data === null) return leaseLost();
    return uuid(data);
  }

  async function getJob(jobId: string): Promise<PublicJob | null> {
    if (!UUID.test(jobId)) return null;
    const result = await client.rpc('read_import', { p_job_id: jobId });
    const data = rpcData(result.data, result.error);
    if (Array.isArray(data) && data.length === 0) return null;
    const row = one(data);
    return row ? publicJob(row) : databaseError();
  }

  async function getVideoState(videoId: string): Promise<VideoState | null> {
    if (!VIDEO_ID.test(videoId)) throw new Error('INVALID_VIDEO_ID');
    const songs = await client.from('songs').select('source,status,needs_reprocess').eq('youtube_video_id', videoId).maybeSingle();
    if (songs.error) databaseError();
    if (!songs.data) return null;
    const song = record(songs.data);
    if (!song || (song.source !== 'manual' && song.source !== 'ai')
      || (song.status !== 'draft' && song.status !== 'published')
      || typeof song.needs_reprocess !== 'boolean') databaseError();
    const metadataResult = await client.from('youtube_metadata').select('video_id,title,duration_seconds,is_public,embeddable,is_live,playable,fetched_at,expires_at').eq('video_id', videoId).maybeSingle();
    if (metadataResult.error) databaseError();
    const metadata = metadataResult.data ? metadataFromRow(metadataResult.data) : null;
    if (metadata && metadata.videoId !== videoId) databaseError();
    return {
      source: song.source,
      status: song.status,
      needsReprocess: song.needs_reprocess,
      metadata,
    };
  }

  return { admit, advance, fail, recordGeminiOutput, complete, completeCached, getJob, getVideoState };
}

export type ImportRepository = ReturnType<typeof createImportRepository>;
