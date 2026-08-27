import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import type { VercelRequest } from '@vercel/node';
import type { ServerConfig } from '../config.js';

export function hashClientIp(ip: string, token: string): string {
  const key = createHmac('sha256', token).update('song-import-rate-limit:v1').digest();
  return createHmac('sha256', key).update(ip).digest('hex');
}

export function createTrustedIp(config: Pick<ServerConfig, 'localDev'>, env: Record<string, string | undefined>) {
  const localAllowed = config.localDev && env.NODE_ENV !== 'production'
    && env.VERCEL_ENV !== 'production' && env.VERCEL_ENV !== 'preview';
  const vercelIngress = env.VERCEL === '1'
    && (env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview');
  return (req: VercelRequest): string | null => {
    const ip = req.socket.remoteAddress;
    if (localAllowed && (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')) return 'local-dev';
    if (vercelIngress) {
      // Vercel overwrites x-forwarded-for on direct deployments to prevent
      // client spoofing. Reject lists or malformed values rather than guessing.
      const forwarded = req.headers['x-forwarded-for'];
      if (typeof forwarded === 'string') {
        const candidate = forwarded.trim();
        if (!candidate.includes(',') && isIP(candidate) !== 0) return candidate;
      }
    }
    return null;
  };
}
