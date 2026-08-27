// @vitest-environment node
import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { compareAccessToken, createSession, readSession, sessionFromCookies, verifySession } from '../../server/access/session';

const token = 'A'.repeat(43);
const now = 1_000;
function signed(payload: unknown): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  const key = createHmac('sha256', token).update('song-import-session:v1').digest();
  return `${bytes.toString('base64url')}.${createHmac('sha256', key).update(bytes).digest('base64url')}`;
}
const valid = { v: 1, purpose: 'song-import', iat: now, exp: now + 28_800, nonce: Buffer.alloc(16, 1).toString('base64url') };

it('expires at exactly eight hours and rejects rotation', () => {
  const value = createSession(token, now);
  expect(verifySession(value, token, now + 28_799)).toBe(true);
  expect(verifySession(value, token, now + 28_800)).toBe(false);
  expect(verifySession(value, 'B'.repeat(43), now + 1)).toBe(false);
});

it('issues independent nonces without placing the access token in the signed payload', () => {
  const first = createSession(token, now);
  const second = createSession(token, now);
  expect(first).not.toBe(second);
  expect(Buffer.from(first.split('.')[0], 'base64url').toString()).not.toContain(token);
  expect(readSession(first, token, now)).toMatchObject({ iat: 1_000, exp: 29_800, purpose: 'song-import', v: 1 });
});

it('requires correct signature bytes and canonical base64url encoding', () => {
  const value = signed(valid);
  const [payload, signature] = value.split('.');
  for (const bad of ['', 'a.b', `${payload}.AA`, `${payload}.${'A'.repeat(43)}`, `${payload}=.${signature}`, `${payload}.${signature}=`, `${value}.extra`, '%zz', 'a'.repeat(2049)]) {
    expect(verifySession(bad, token, now), bad.slice(0, 20)).toBe(false);
  }
  const edited = Buffer.from(JSON.stringify({ ...valid, exp: 99_999 })).toString('base64url');
  expect(verifySession(`${edited}.${signature}`, token, now)).toBe(false);
});

it.each([
  { ...valid, v: 2 }, { ...valid, purpose: 'other' }, { ...valid, iat: now + 61, exp: now + 61 + 28_800 },
  { ...valid, exp: now + 28_801 }, { ...valid, exp: now + 28_799 }, { ...valid, iat: 1.5 },
  { ...valid, exp: '29800' }, { ...valid, nonce: '' }, { ...valid, extra: true }, null,
])('rejects signed but invalid session schema %#', (payload) => {
  expect(verifySession(signed(payload), token, now)).toBe(false);
});

it('allows at most sixty seconds of clock skew', () => {
  expect(verifySession(signed({ ...valid, iat: 1_060, exp: 29_860 }), token, now)).toBe(true);
});

it('rejects duplicate, malformed and oversized Cookie headers', () => {
  const value = createSession(token, now);
  expect(sessionFromCookies(`other=ok; song_import_session=${value}`, token, now)?.exp).toBe(29_800);
  for (const cookie of [undefined, `song_import_session=${value}; song_import_session=${value}`, `song_import_session=%${value}`, `song_import_session=${value}; other=${'x'.repeat(2048)}`]) {
    expect(sessionFromCookies(cookie, token, now)).toBeNull();
  }
});

it('compares token digests but rejects empty, malformed and wrong values', () => {
  expect(compareAccessToken(token, token)).toBe(true);
  for (const candidate of ['', 'B'.repeat(43), ` ${token}`, token + '=', '💥'.repeat(43)]) {
    expect(compareAccessToken(candidate, token)).toBe(false);
  }
});
