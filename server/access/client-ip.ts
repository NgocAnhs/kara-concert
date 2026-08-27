import { createHmac } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import type { ServerConfig } from '../config.js';

export function hashClientIp(ip: string, token: string): string {
  const key = createHmac('sha256', token).update('song-import-rate-limit:v1').digest();
  return createHmac('sha256', key).update(ip).digest('hex');
}

export function createTrustedIp(config: Pick<ServerConfig, 'localDev'>, env: Record<string, string | undefined>) {
  const localAllowed = config.localDev && env.NODE_ENV !== 'production'
    && env.VERCEL_ENV !== 'production' && env.VERCEL_ENV !== 'preview';
  return (req: VercelRequest): string | null => {
    const ip = req.socket.remoteAddress;
    if (localAllowed && (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')) return 'local-dev';
    // Release gate: direct deployed Vercel ingress has not been verified. Do not
    // infer trust from client forwarding headers or add a bypass environment flag.
    return null;
  };
}
