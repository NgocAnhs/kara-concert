import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { ServerConfig } from './config.js';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, sessionFromCookies, type ImportSession } from './access/session.js';

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly clearSession = false) {
    super(code);
  }
}

export function assertOrigin(req: VercelRequest, config: Pick<ServerConfig, 'appOrigin'>): void {
  if (typeof req.headers.origin !== 'string' || req.headers.origin !== config.appOrigin) throw new HttpError(403, 'ORIGIN_REQUIRED');
}

export async function readJsonBody(req: VercelRequest): Promise<unknown> {
  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(contentType)
    || (req.headers['content-encoding'] !== undefined && req.headers['content-encoding'] !== 'identity')) {
    throw new HttpError(415, 'JSON_REQUIRED');
  }
  const length = req.headers['content-length'];
  if (length !== undefined && (typeof length !== 'string' || !/^\d+$/.test(length))) throw new HttpError(400, 'INVALID_REQUEST');
  if (length !== undefined && Number(length) > 4096) throw new HttpError(413, 'BODY_TOO_LARGE');

  const bytes = await new Promise<Buffer>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let settled = false;
    const fail = (error: HttpError) => { if (!settled) { settled = true; reject(error); } };
    // @vercel/node helpers replay raw bytes via on('data'/'end'), even though
    // readableEnded describes the original stream. Never read req.body or use
    // an async iterator here; both would miss the original raw byte boundary.
    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 4096) { chunks.length = 0; fail(new HttpError(413, 'BODY_TOO_LARGE')); }
      else chunks.push(buffer);
    });
    req.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', () => fail(new HttpError(400, 'INVALID_REQUEST')));
    req.on('aborted', () => fail(new HttpError(400, 'INVALID_REQUEST')));
  });
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new HttpError(400, 'INVALID_REQUEST');
  }
}

export function sessionCookie(value: string, config: Pick<ServerConfig, 'localDev'>, clear = false): string {
  return `${SESSION_COOKIE}=${value}; Path=/api; Max-Age=${clear ? 0 : SESSION_TTL_SECONDS}; HttpOnly${config.localDev ? '' : '; Secure'}; SameSite=Strict`;
}

export function requireImportSession(req: VercelRequest, config: ServerConfig | undefined, nowSeconds = Math.floor(Date.now() / 1000)): ImportSession {
  if (!config?.importAccessToken || !config.appOrigin) throw new HttpError(503, 'CONFIG_UNAVAILABLE');
  const session = sessionFromCookies(req.headers.cookie, config.importAccessToken, nowSeconds);
  if (!session) throw new HttpError(401, 'ACCESS_REQUIRED', true);
  return session;
}

export function sendJson(res: VercelResponse, status: number, body: unknown): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

export function sendError(res: VercelResponse, error: unknown, config?: Pick<ServerConfig, 'localDev'>): void {
  if (error instanceof HttpError) {
    if (error.clearSession && config) res.setHeader('Set-Cookie', sessionCookie('', config, true));
    sendJson(res, error.status, { error: error.code });
  } else {
    sendJson(res, 503, { error: 'CONFIG_UNAVAILABLE' });
  }
}
