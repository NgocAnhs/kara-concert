// @vitest-environment node
import { expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { readServerConfig } from '../../server/config';
import { assertOrigin, readJsonBody, requireImportSession, sendError } from '../../server/http';
import { createSession } from '../../server/access/session';
import { request, response } from './http-fixtures';
const config = readServerConfig({ IMPORT_ACCESS_TOKEN: 'A'.repeat(43), APP_ORIGIN: 'https://app.test' });

it.each([undefined, 'null', 'https://evil.test', 'https://app.test/', ['https://app.test', 'https://evil.test']])('rejects missing, null or non-exact origin %#', (origin) => {
  expect(() => assertOrigin(request('POST', '{}', { origin }), config)).toThrow('ORIGIN_REQUIRED');
});

it('accepts only the configured origin, independent of forwarded host headers', () => {
  expect(() => assertOrigin(request(), config)).not.toThrow();
  expect(() => assertOrigin(request('POST', '{}', { origin: 'https://evil.test', 'x-forwarded-host': 'app.test' }), config)).toThrow('ORIGIN_REQUIRED');
});

it.each(['text/plain', 'application/jsonp', undefined, 'application/json; charset=iso-8859-1'])('rejects unsupported content types %#', async (contentType) => {
  await expect(readJsonBody(request('POST', '{}', { 'content-type': contentType }))).rejects.toMatchObject({ status: 415 });
});

it('parses JSON from raw bytes without accessing Vercel parsed-body helpers', async () => {
  const req = request('POST', '{"ok":true}', { 'content-type': 'application/json; charset=utf-8' });
  Object.defineProperty(req, 'body', { get() { throw new Error('parsed getter must not run'); } });
  expect(await readJsonBody(req)).toEqual({ ok: true });
});

it('reads the Vercel replay stream even when the original stream has already ended', async () => {
  const req = request();
  Object.defineProperty(req, 'readableEnded', { value: true });
  const replay = new PassThrough();
  const originalOn = req.on.bind(req);
  req.on = req.addListener = ((name: string, cb: (...args: unknown[]) => void) => name === 'data' || name === 'end' ? replay.on(name, cb) : originalOn(name, cb)) as typeof req.on;
  replay.end('{"ok":true}');
  expect(await readJsonBody(req)).toEqual({ ok: true });
});

it.each(['{', '', Buffer.from([0xff])])('rejects malformed JSON or UTF-8 bytes %#', async (body) => {
  await expect(readJsonBody(request('POST', body))).rejects.toMatchObject({ status: 400 });
});

it('keeps the default JSON request limit at 4KiB', async () => {
  expect(await readJsonBody(request('POST', '{}'.padEnd(4096)))).toEqual({});
  await expect(readJsonBody(request('POST', '{}'.padEnd(4097)))).rejects.toMatchObject({ status: 413 });
  await expect(readJsonBody(request('POST', JSON.stringify({ x: '한'.repeat(1500) })))).rejects.toMatchObject({ status: 413 });
});

it('rejects oversized Content-Length before consuming the body and unsupported compression', async () => {
  await expect(readJsonBody(request('POST', '{}', { 'content-length': '4097' }))).rejects.toMatchObject({ status: 413 });
  await expect(readJsonBody(request('POST', '{}', { 'content-encoding': 'gzip' }))).rejects.toMatchObject({ status: 415 });
});

it('allows a caller to opt into a 64KiB JSON request limit', async () => {
  expect(await readJsonBody(request('POST', '{}'.padEnd(65_536)), 65_536)).toEqual({});
  await expect(readJsonBody(request('POST', '{}'.padEnd(65_537)), 65_536)).rejects.toMatchObject({ status: 413 });
});

it('requires a valid session before callers can continue to import work', () => {
  expect(() => requireImportSession(request('GET'), config, 1000)).toThrow('ACCESS_REQUIRED');
  const valid = createSession(config.importAccessToken, 1000);
  expect(requireImportSession(request('GET', '', { cookie: `song_import_session=${valid}` }), config, 1001).exp).toBe(29800);
  expect(() => requireImportSession(request('GET'), undefined, 1000)).toThrow('CONFIG_UNAVAILABLE');
});

it('clears rejected import sessions and never exposes arbitrary exception text', () => {
  const out = response();
  try { requireImportSession(request('GET'), config, 1000); } catch (error) { sendError(out.res, error, config); }
  expect(out.status).toBe(401);
  expect(out.headers['set-cookie']).toBe('song_import_session=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Strict');
  expect(out.headers['cache-control']).toBe('no-store');
  const other = response();
  sendError(other.res, new Error('secret-token-value'));
  expect(other.status).toBe(503);
  expect(other.body).not.toContain('secret-token-value');
});
