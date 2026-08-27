import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const SESSION_COOKIE = 'song_import_session';
export const SESSION_TTL_SECONDS = 28_800;
const COOKIE_MAX_BYTES = 2_048;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const sessionSchema = z.object({
  v: z.literal(1),
  purpose: z.literal('song-import'),
  iat: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  exp: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
}).strict();
export type ImportSession = z.infer<typeof sessionSchema>;

function signingKey(token: string): Buffer {
  return createHmac('sha256', token).update('song-import-session:v1').digest();
}
function decodeCanonical(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.toString('base64url') === value ? bytes : null;
}

export function compareAccessToken(candidate: string, token: string): boolean {
  const actual = createHash('sha256').update(candidate).digest();
  const expected = createHash('sha256').update(token).digest();
  const equal = timingSafeEqual(actual, expected);
  return TOKEN_FORMAT.test(candidate) && equal;
}

export function createSession(token: string, nowSeconds: number): string {
  if (!TOKEN_FORMAT.test(token) || !Number.isSafeInteger(nowSeconds) || nowSeconds < 0) throw new Error('CONFIG_UNAVAILABLE');
  const payload: ImportSession = {
    v: 1, purpose: 'song-import', iat: nowSeconds, exp: nowSeconds + SESSION_TTL_SECONDS,
    nonce: randomBytes(16).toString('base64url'),
  };
  const bytes = Buffer.from(JSON.stringify(payload));
  const signature = createHmac('sha256', signingKey(token)).update(bytes).digest('base64url');
  return `${bytes.toString('base64url')}.${signature}`;
}

export function readSession(cookieValue: string, token: string, nowSeconds: number): ImportSession | null {
  if (Buffer.byteLength(cookieValue) > COOKIE_MAX_BYTES || !TOKEN_FORMAT.test(token) || !Number.isSafeInteger(nowSeconds)) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;
  const payloadBytes = decodeCanonical(parts[0]);
  const signature = decodeCanonical(parts[1]);
  if (!payloadBytes || !signature || signature.length !== 32) return null;
  const expected = createHmac('sha256', signingKey(token)).update(payloadBytes).digest();
  // Authenticate the exact bytes before parsing or trusting any payload field.
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    const parsed = sessionSchema.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes)));
    if (!parsed.success) return null;
    const value = parsed.data;
    if (!decodeCanonical(value.nonce) || value.iat > nowSeconds + 60
      || value.exp - value.iat !== SESSION_TTL_SECONDS || nowSeconds >= value.exp) return null;
    return value;
  } catch {
    return null;
  }
}

export function verifySession(cookieValue: string, token: string, nowSeconds: number): boolean {
  return readSession(cookieValue, token, nowSeconds) !== null;
}

export function sessionFromCookies(cookieHeader: string | undefined, token: string, nowSeconds: number): ImportSession | null {
  if (!cookieHeader || Buffer.byteLength(cookieHeader) > COOKIE_MAX_BYTES) return null;
  const values: string[] = [];
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if ((separator < 0 ? part.trim() : part.slice(0, separator).trim()) === SESSION_COOKIE) {
      values.push(separator < 0 ? '' : part.slice(separator + 1).trim());
    }
  }
  // Do not decode percent escapes: our cookie uses canonical base64url only.
  return values.length === 1 ? readSession(values[0], token, nowSeconds) : null;
}
