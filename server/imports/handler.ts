import { waitUntil } from '@vercel/functions';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import type { ServerConfig } from '../config.js';
import { assertOrigin, HttpError, readJsonBody, requireImportSession, sendError, sendJson } from '../http.js';
import type { Admission, ImportRepository } from './repository.js';
import { runImport, type ImportRunnerDependencies } from './runner.js';
import { parseYouTubeUrl } from './youtube-url.js';

const importSchema = z.object({ youtubeUrl: z.string().max(4096) }).strict();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type HandlerRepository = Pick<ImportRepository, 'admit' | 'getJob'> & ImportRunnerDependencies['repository'];

export type ImportHandlerDependencies = {
  config: ServerConfig | undefined;
  repository: HandlerRepository;
  runnerDeps: Omit<ImportRunnerDependencies, 'repository'>;
  background?: (promise: Promise<unknown>) => void;
  nowSeconds?: () => number;
};

function statusUrl(jobId: string): string {
  return `/api/imports/${jobId}`;
}

function sendAdmission(res: VercelResponse, admission: Exclude<Admission, { kind: 'created' | 'rejected' }>): void {
  if (admission.kind === 'cached') {
    sendJson(res, 200, { songId: admission.songId });
    return;
  }
  sendJson(res, 202, { jobId: admission.job.jobId, status: admission.job.status, statusUrl: statusUrl(admission.job.jobId) });
}

function rejectAdmission(res: VercelResponse, admission: Extract<Admission, { kind: 'rejected' }>): void {
  if ((admission.code === 'DAILY_LIMIT' || admission.code === 'ACTIVE_LIMIT')
    && Number.isSafeInteger(admission.retryAfterSeconds) && admission.retryAfterSeconds! > 0) {
    res.setHeader('Retry-After', String(admission.retryAfterSeconds));
    throw new HttpError(429, admission.code);
  }
  if (admission.code === 'VIDEO_UNAVAILABLE') throw new HttpError(422, admission.code);
  throw new HttpError(503, 'IMPORT_UNAVAILABLE');
}

async function registerCreated(
  admission: Extract<Admission, { kind: 'created' }>,
  videoId: string,
  deps: ImportHandlerDependencies,
): Promise<void> {
  let cancelled = false;
  const task = Promise.resolve().then(async () => {
    if (!cancelled) await runImport(admission.lease, videoId, { repository: deps.repository, ...deps.runnerDeps });
  });
  void task.catch(() => undefined);
  try {
    (deps.background ?? ((promise) => { waitUntil(promise); }))(task);
  } catch {
    cancelled = true;
    try { await deps.repository.fail(admission.lease, 'PROVIDER_TRANSIENT'); } catch { /* Lease expiry reclaims the slot. */ }
    throw new HttpError(503, 'IMPORT_UNAVAILABLE');
  }
}

export function createImportHandler(deps: ImportHandlerDependencies) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        throw new HttpError(405, 'METHOD_NOT_ALLOWED');
      }
      requireImportSession(req, deps.config, (deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))());
      const config = deps.config!;
      if (!config.importEnabled) throw new HttpError(503, 'IMPORT_UNAVAILABLE');
      assertOrigin(req, config);
      const parsed = importSchema.safeParse(await readJsonBody(req));
      if (!parsed.success) throw new HttpError(400, 'INVALID_REQUEST');
      let videoId: string;
      try { videoId = parseYouTubeUrl(parsed.data.youtubeUrl).videoId; }
      catch { throw new HttpError(400, 'INVALID_YOUTUBE_URL'); }

      const admission = await deps.repository.admit(videoId);
      if (admission.kind === 'rejected') return rejectAdmission(res, admission);
      if (admission.kind !== 'created') return sendAdmission(res, admission);

      await registerCreated(admission, videoId, deps);
      sendJson(res, 202, { jobId: admission.job.jobId, status: 'checking_video', statusUrl: statusUrl(admission.job.jobId) });
    } catch (error) {
      sendError(res, error, deps.config);
    }
  };
}

export function createImportStatusHandler(deps: ImportHandlerDependencies) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        throw new HttpError(405, 'METHOD_NOT_ALLOWED');
      }
      requireImportSession(req, deps.config, (deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))());
      const id = req.query.id;
      if (typeof id !== 'string' || !UUID.test(id)) throw new HttpError(404, 'IMPORT_NOT_FOUND');
      const job = await deps.repository.getJob(id);
      if (!job) throw new HttpError(404, 'IMPORT_NOT_FOUND');
      sendJson(res, 200, job);
    } catch (error) {
      sendError(res, error, deps.config);
    }
  };
}
