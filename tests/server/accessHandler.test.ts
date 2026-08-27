// @vitest-environment node
import { expect, it } from 'vitest';
import { readServerConfig } from '../../server/config';
import { createAccessHandler } from '../../server/access/handler';
import { createSession } from '../../server/access/session';
import { createTrustedIp, hashClientIp } from '../../server/access/client-ip';
import { request, response } from './http-fixtures';
const token = 'A'.repeat(43);
const config = readServerConfig({ IMPORT_ACCESS_TOKEN: token, APP_ORIGIN: 'https://app.test' });
function setup(overrides = {}) {
  const attempts: string[] = [];
  const handler = createAccessHandler({ config, now: () => 1000, trustedIp: () => 'local-dev', consumeAttempt: async (ipHash: string) => {
    attempts.push(ipHash); return { allowed: true, retryAfterSeconds: 0 };
  }, ...overrides });
  return { handler, attempts };
}

it('opens a session with secure cookie flags and no secret in the JSON response', async () => {
  const { handler, attempts } = setup(); const out = response();
  await handler(request('POST', JSON.stringify({ token })), out.res);
  expect(out.status).toBe(200);
  expect(out.json()).toEqual({ unlocked: true, expiresAt: 29800 });
  expect(out.headers['set-cookie']).toMatch(/^song_import_session=.+; Path=\/api; Max-Age=28800; HttpOnly; Secure; SameSite=Strict$/);
  expect(out.headers['set-cookie']).not.toContain('Domain=');
  expect(out.body).not.toContain(token);
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatch(/^[a-f0-9]{64}$/);
  expect(attempts[0]).not.toContain('local-dev');
  expect(out.headers['cache-control']).toBe('no-store');
});

it.each(['', 'bad', 'B'.repeat(43)])('counts invalid token attempts with the same generic 401 %#', async (candidate) => {
  const { handler, attempts } = setup(); const out = response();
  await handler(request('POST', JSON.stringify({ token: candidate })), out.res);
  expect(out.status).toBe(401); expect(out.json()).toEqual({ error: 'ACCESS_REQUIRED' });
  expect(attempts).toHaveLength(1);
  expect(out.headers['set-cookie']).toBeUndefined();
});

it.each(['{}', '{"token":1}', '{"token":"bad","other":true}', 'null', '[]', '{'])('rejects invalid schema before consuming an attempt %#', async (body) => {
  const { handler, attempts } = setup(); const out = response();
  await handler(request('POST', body), out.res);
  expect(out.status).toBe(400); expect(attempts).toHaveLength(0);
});

it('checks origin before content type, body, rate limit or token', async () => {
  const { handler, attempts } = setup(); const out = response();
  await handler(request('POST', '{', { origin: 'null', 'content-type': 'text/plain' }), out.res);
  expect(out.status).toBe(403); expect(attempts).toHaveLength(0);
});

it('returns 429 and Retry-After even for the correct token once the bucket is full', async () => {
  const { handler } = setup({ consumeAttempt: async () => ({ allowed: false, retryAfterSeconds: 895 }) }); const out = response();
  await handler(request('POST', JSON.stringify({ token })), out.res);
  expect(out.status).toBe(429); expect(out.headers['retry-after']).toBe('895');
  expect(out.headers['set-cookie']).toBeUndefined();
});

it.each([
  { trustedIp: () => null },
  { consumeAttempt: async () => { throw new Error('database-secret-error'); } },
  { consumeAttempt: async () => ({ allowed: true, retryAfterSeconds: -1 }) },
  { config: undefined },
])('fails closed on unavailable configuration, IP or rate storage %#', async (override) => {
  const { handler } = setup(override); const out = response();
  await handler(request('POST', JSON.stringify({ token })), out.res);
  expect(out.status).toBe(503); expect(out.body).not.toContain('database-secret-error');
  expect(out.headers['set-cookie']).toBeUndefined();
});

it('reads valid/forged/rotated cookies without using the limiter', async () => {
  const { handler, attempts } = setup();
  for (const [cookie, expected] of [
    [undefined, { unlocked: false }], ['song_import_session=forged', { unlocked: false }],
    [`song_import_session=${createSession(token, 1000)}`, { unlocked: true, expiresAt: 29800 }],
    [`song_import_session=${createSession('B'.repeat(43), 1000)}`, { unlocked: false }],
  ] as const) {
    const out = response(); await handler(request('GET', '', { cookie }), out.res);
    expect(out.status).toBe(200); expect(out.json()).toEqual(expected);
  }
  expect(attempts).toHaveLength(0);
});

it('logs out even a stale session and refuses nonempty logout JSON', async () => {
  const { handler, attempts } = setup(); const out = response();
  await handler(request('DELETE', '{}', { cookie: 'song_import_session=stale' }), out.res);
  expect(out.status).toBe(204); expect(out.body).toBe('');
  expect(out.headers['set-cookie']).toBe('song_import_session=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Strict');
  const invalid = response(); await handler(request('DELETE', '{"token":"anything"}'), invalid.res);
  expect(invalid.status).toBe(400); expect(attempts).toHaveLength(0);
});

it('omits Secure only for explicitly configured local development', async () => {
  const { handler } = setup({ config: { ...config, localDev: true, appOrigin: 'http://127.0.0.1:3000' } }); const out = response();
  await handler(request('POST', JSON.stringify({ token }), { origin: 'http://127.0.0.1:3000' }), out.res);
  expect(out.headers['set-cookie']).not.toContain('Secure');
});

it('rejects unsupported methods with Allow and no-store', async () => {
  const { handler } = setup(); const out = response();
  await handler(request('OPTIONS'), out.res);
  expect(out.status).toBe(405); expect(out.headers.allow).toBe('GET, POST, DELETE');
  expect(out.headers['cache-control']).toBe('no-store');
});

it('uses a separate derivation label for the IP hash and ignores client IP headers locally', () => {
  const trustedIp = createTrustedIp({ ...config, localDev: true }, { VERCEL_ENV: 'development' });
  const one = request('POST', '{}', { 'x-forwarded-for': '198.51.100.1' });
  const two = request('POST', '{}', { 'x-forwarded-for': '198.51.100.2', 'x-vercel-forwarded-for': '198.51.100.3' });
  expect(trustedIp(one)).toBe('local-dev'); expect(trustedIp(two)).toBe('local-dev');
  expect(hashClientIp('local-dev', token)).toBe(hashClientIp('local-dev', token));
  expect(hashClientIp('local-dev', token)).not.toBe(hashClientIp('local-dev', 'B'.repeat(43)));
});

it('never trusts forwarded headers on nonloopback or unverified deployed ingress', () => {
  const req = request('POST', '{}', { 'x-vercel-forwarded-for': '198.51.100.1' });
  for (const env of [{ VERCEL_ENV: 'production' }, { VERCEL_ENV: 'preview' }, { NODE_ENV: 'production' }]) {
    expect(createTrustedIp({ ...config, localDev: true }, env)(req)).toBeNull();
  }
  expect(createTrustedIp(config, { VERCEL: '1', VERCEL_ENV: 'production' })(req)).toBeNull();
  Object.defineProperty(req, 'socket', { value: { remoteAddress: '198.51.100.2' } });
  expect(createTrustedIp({ ...config, localDev: true }, {})(req)).toBeNull();
});

it('keeps GET and DELETE available without database/provider credentials, but POST fails closed', async () => {
  const { createRuntimeAccessHandler } = await import('../../server/runtime');
  const handler = createRuntimeAccessHandler({ IMPORT_ACCESS_TOKEN: token, APP_ORIGIN: 'http://127.0.0.1:3000', IMPORT_LOCAL_DEV: 'true' });
  for (const [method, body, expected] of [['GET', '', 200], ['DELETE', '{}', 204], ['POST', JSON.stringify({ token }), 503]] as const) {
    const out = response();
    await handler(request(method, body, { origin: 'http://127.0.0.1:3000' }), out.res);
    expect(out.status).toBe(expected);
  }
});

it('turns missing server configuration into safe HTTP 503 instead of an entrypoint crash', async () => {
  const { createRuntimeAccessHandler } = await import('../../server/runtime');
  const out = response(); await createRuntimeAccessHandler({})(request('GET'), out.res);
  expect(out.status).toBe(503); expect(out.json()).toEqual({ error: 'CONFIG_UNAVAILABLE' });
});

it('maps the real RPC wire shape and sends only a hashed IP to the database', async () => {
  const { vi } = await import('vitest');
  const { createRuntimeAccessHandler } = await import('../../server/runtime');
  const seen: { url?: string; body?: string } = {};
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    seen.url = String(url); seen.body = String(init.body);
    return new Response(JSON.stringify([{ allowed: true, retry_after_seconds: 0 }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  try {
    const handler = createRuntimeAccessHandler({ IMPORT_ACCESS_TOKEN: token, APP_ORIGIN: 'http://127.0.0.1:3000', IMPORT_LOCAL_DEV: 'true', SUPABASE_URL: 'http://127.0.0.1:55321', SUPABASE_SERVER_KEY: 'local-test-key' });
    const out = response();
    await handler(request('POST', JSON.stringify({ token }), { origin: 'http://127.0.0.1:3000' }), out.res);
    expect(out.status).toBe(200);
    expect(seen.url).toBe('http://127.0.0.1:55321/rest/v1/rpc/consume_access_attempt');
    expect(JSON.parse(seen.body!)).toEqual({ p_ip_hash: hashClientIp('local-dev', token) });
  } finally { vi.unstubAllGlobals(); }
});

it.each([null, [], [{ allowed: 'true', retry_after_seconds: 0 }], [{ allowed: false, retry_after_seconds: 0 }], [{ allowed: true, retry_after_seconds: 0 }, { allowed: true, retry_after_seconds: 0 }]])('rejects malformed RPC responses without minting a cookie %#', async (data) => {
  const { vi } = await import('vitest');
  const { createRuntimeAccessHandler } = await import('../../server/runtime');
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  try {
    const out = response();
    await createRuntimeAccessHandler({ IMPORT_ACCESS_TOKEN: token, APP_ORIGIN: 'http://127.0.0.1:3000', IMPORT_LOCAL_DEV: 'true', SUPABASE_URL: 'http://127.0.0.1:55321', SUPABASE_SERVER_KEY: 'local-test-key' })(request('POST', JSON.stringify({ token }), { origin: 'http://127.0.0.1:3000' }), out.res);
    expect(out.status).toBe(503); expect(out.headers['set-cookie']).toBeUndefined();
  } finally { vi.unstubAllGlobals(); }
});
