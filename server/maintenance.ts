import { createHash, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { VideoMetadata } from './imports/types.js';
import { ProviderFailure } from './imports/youtube.js';
import { sendJson } from './http.js';

export type MaintenanceLease = { leaseToken: string; deadlineAt: string };

export type MaintenanceDependencies = {
  beginMaintenance(): Promise<MaintenanceLease | null>;
  cleanupImportData(leaseToken: string): Promise<string[]>;
  applyMetadataRefresh(leaseToken: string, metadata: VideoMetadata): Promise<boolean>;
  markMetadataUnavailable(leaseToken: string, videoId: string): Promise<boolean>;
  finishMaintenance(leaseToken: string): Promise<boolean>;
  fetchVideo(videoId: string, options: { signal: AbortSignal }): Promise<VideoMetadata>;
  now(): number;
};

type DatabaseClient = Pick<SupabaseClient, 'rpc'>;
type RpcResult = { data: unknown; error: unknown };
type RecordValue = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const VIDEO_REQUEST_TIMEOUT_MS = 15_000;

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}

function databaseData(result: RpcResult): unknown {
  if (result.error) throw new Error('MAINTENANCE_DATABASE_ERROR');
  return result.data;
}

function asBoolean(result: RpcResult): boolean {
  const data = databaseData(result);
  if (typeof data !== 'boolean') throw new Error('MAINTENANCE_DATABASE_ERROR');
  return data;
}

export function createMaintenanceRepository(client: DatabaseClient) {
  if (!client || typeof client.rpc !== 'function') throw new Error('CONFIG_UNAVAILABLE');
  return {
    async beginMaintenance(): Promise<MaintenanceLease | null> {
      const data = databaseData(await client.rpc('begin_maintenance'));
      if (!Array.isArray(data)) throw new Error('MAINTENANCE_DATABASE_ERROR');
      if (data.length === 0) return null;
      if (data.length !== 1) throw new Error('MAINTENANCE_DATABASE_ERROR');
      const row = record(data[0]);
      if (!row || typeof row.lease_token !== 'string' || !UUID.test(row.lease_token)
        || typeof row.deadline_at !== 'string' || !Number.isFinite(Date.parse(row.deadline_at))) {
        throw new Error('MAINTENANCE_DATABASE_ERROR');
      }
      return { leaseToken: row.lease_token, deadlineAt: row.deadline_at };
    },
    async cleanupImportData(leaseToken: string): Promise<string[]> {
      const data = databaseData(await client.rpc('cleanup_import_data', { p_lease_token: leaseToken }));
      if (!Array.isArray(data) || data.length > 12) throw new Error('MAINTENANCE_DATABASE_ERROR');
      const videos = data.map((value) => record(value)?.video_id);
      if (videos.some((videoId) => typeof videoId !== 'string' || !VIDEO_ID.test(videoId))) {
        throw new Error('MAINTENANCE_DATABASE_ERROR');
      }
      return videos as string[];
    },
    applyMetadataRefresh: async (leaseToken: string, metadata: VideoMetadata) => asBoolean(
      await client.rpc('apply_metadata_refresh', { p_lease_token: leaseToken, p_metadata: metadata }),
    ),
    markMetadataUnavailable: async (leaseToken: string, videoId: string) => asBoolean(
      await client.rpc('mark_metadata_unavailable', { p_lease_token: leaseToken, p_video_id: videoId }),
    ),
    finishMaintenance: async (leaseToken: string) => asBoolean(
      await client.rpc('finish_maintenance', { p_lease_token: leaseToken }),
    ),
  };
}

function incomplete(): never {
  throw new Error('MAINTENANCE_INCOMPLETE');
}

export async function runMaintenance(deps: MaintenanceDependencies): Promise<void> {
  const lease = await deps.beginMaintenance();
  if (!lease) return;
  const deadline = Date.parse(lease.deadlineAt);
  if (!Number.isFinite(deadline)) incomplete();

  const videoIds = await deps.cleanupImportData(lease.leaseToken);
  let transientFailure = false;
  for (const videoId of videoIds) {
    if (deps.now() >= deadline) incomplete();
    const controller = new AbortController();
    const remaining = Math.max(0, deadline - deps.now());
    const timeout = setTimeout(() => controller.abort(), Math.min(VIDEO_REQUEST_TIMEOUT_MS, remaining));
    try {
      const metadata = await deps.fetchVideo(videoId, { signal: controller.signal });
      if (!await deps.applyMetadataRefresh(lease.leaseToken, metadata)) incomplete();
    } catch (error) {
      if (error instanceof ProviderFailure && error.code === 'VIDEO_UNAVAILABLE') {
        if (!await deps.markMetadataUnavailable(lease.leaseToken, videoId)) incomplete();
      } else {
        transientFailure = true;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  if (transientFailure || deps.now() >= deadline) incomplete();
  if (!await deps.finishMaintenance(lease.leaseToken)) incomplete();
}

function authorized(value: string | string[] | undefined, secret: string): boolean {
  if (typeof value !== 'string') return false;
  const supplied = createHash('sha256').update(value).digest();
  const expected = createHash('sha256').update(`Bearer ${secret}`).digest();
  return timingSafeEqual(supplied, expected);
}

type MaintenanceHandlerOptions = { cronSecret?: string; run(): Promise<void> };

export function createMaintenanceHandler({ cronSecret, run }: MaintenanceHandlerOptions) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    if (!cronSecret) {
      sendJson(res, 503, { error: 'CONFIG_UNAVAILABLE' });
      return;
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    if (!authorized(req.headers.authorization, cronSecret)) {
      sendJson(res, 401, { error: 'CRON_AUTH_REQUIRED' });
      return;
    }
    try {
      await run();
      sendJson(res, 200, { ok: true });
    } catch {
      sendJson(res, 503, { error: 'MAINTENANCE_UNAVAILABLE' });
    }
  };
}
