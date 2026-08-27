import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import type { ServerConfig } from '../config.js';
import { assertOrigin, HttpError, readJsonBody, sendError, sendJson, sessionCookie } from '../http.js';
import { compareAccessToken, createSession, SESSION_TTL_SECONDS, sessionFromCookies } from './session.js';
import { hashClientIp } from './client-ip.js';

export type AccessAttempt = { allowed: boolean; retryAfterSeconds: number };
export type AccessDependencies = {
  config: ServerConfig | undefined;
  now: () => number;
  consumeAttempt: (ipHash: string) => Promise<AccessAttempt>;
  trustedIp: (req: VercelRequest) => string | null;
};
const loginSchema = z.object({ token: z.string() }).strict();
const logoutSchema = z.object({}).strict();

export function createAccessHandler(deps: AccessDependencies) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (!['GET', 'POST', 'DELETE'].includes(req.method || '')) {
        res.setHeader('Allow', 'GET, POST, DELETE');
        throw new HttpError(405, 'METHOD_NOT_ALLOWED');
      }
      const config = deps.config;
      if (!config?.importAccessToken || !config.appOrigin) throw new HttpError(503, 'CONFIG_UNAVAILABLE');
      if (req.method === 'GET') {
        const session = sessionFromCookies(req.headers.cookie, config.importAccessToken, deps.now());
        sendJson(res, 200, session ? { unlocked: true, expiresAt: session.exp } : { unlocked: false });
        return;
      }
      assertOrigin(req, config);
      const body = await readJsonBody(req);
      if (req.method === 'DELETE') {
        if (!logoutSchema.safeParse(body).success) throw new HttpError(400, 'INVALID_REQUEST');
        res.setHeader('Set-Cookie', sessionCookie('', config, true));
        res.statusCode = 204;
        res.end();
        return;
      }
      const parsed = loginSchema.safeParse(body);
      if (!parsed.success) throw new HttpError(400, 'INVALID_REQUEST');
      const ip = deps.trustedIp(req);
      if (!ip) throw new HttpError(503, 'CONFIG_UNAVAILABLE');
      const attempt = await deps.consumeAttempt(hashClientIp(ip, config.importAccessToken));
      if (typeof attempt?.allowed !== 'boolean' || !Number.isSafeInteger(attempt.retryAfterSeconds)
        || attempt.retryAfterSeconds < 0 || (!attempt.allowed && attempt.retryAfterSeconds < 1)) throw new HttpError(503, 'CONFIG_UNAVAILABLE');
      if (!attempt.allowed) {
        res.setHeader('Retry-After', String(attempt.retryAfterSeconds));
        throw new HttpError(429, 'TOO_MANY_ATTEMPTS');
      }
      if (!compareAccessToken(parsed.data.token, config.importAccessToken)) throw new HttpError(401, 'ACCESS_REQUIRED');
      const now = deps.now();
      const value = createSession(config.importAccessToken, now);
      res.setHeader('Set-Cookie', sessionCookie(value, config));
      sendJson(res, 200, { unlocked: true, expiresAt: now + SESSION_TTL_SECONDS });
    } catch (error) {
      sendError(res, error, deps.config);
    }
  };
}
