// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createServerDb } from '../../server/db';
import { createLocalDbCliEnv, validateLocalDbStatus, validateDbTestArgs } from '../../scripts/test-db.mjs';

afterEach(() => vi.unstubAllGlobals());

it('creates a stateless backend client using only database credentials (including cron)', async () => {
  const db = createServerDb({ supabaseUrl: 'http://127.0.0.1:55321', supabaseServerKey: 'local-test-only' });
  expect(db.auth).toMatchObject({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  expect((await db.auth.getSession()).data.session).toBeNull();
});

it('fails closed in a browser before constructing a privileged client', () => {
  vi.stubGlobal('window', {});
  expect(() => createServerDb({ supabaseUrl: 'http://127.0.0.1:55321', supabaseServerKey: 'local-test-only' }))
    .toThrow('SERVER_ONLY');
});

it.each(['http://example.test', 'http://192.0.2.1:55321', 'http://localhost:55321',
  'https://user:private-value@example.test', 'https://example.test?key=private-value',
  'https://example.test#private-value', 'https://example.test?', 'https://example.test#',
  'ftp://example.test', 'https://[broken'])('rejects unsafe backend URLs without exposing values: %s', (supabaseUrl) => {
  expect(() => createServerDb({ supabaseUrl, supabaseServerKey: 'private-test-key' }))
    .toThrow(/^CONFIG_UNAVAILABLE$/);
});

it.each(['https://example.supabase.co', 'http://127.0.0.1:55321', 'http://[::1]:55321'])(
  'accepts HTTPS or a literal loopback development endpoint: %s', async (supabaseUrl) => {
    const db = createServerDb({ supabaseUrl, supabaseServerKey: 'local-test-only' });
    expect((await db.auth.getSession()).data.session).toBeNull();
  },
);

it.each([{}, { supabaseUrl: 'https://example.test' }, { supabaseServerKey: 'do-not-print' },
  { supabaseUrl: 'bad-url-do-not-print', supabaseServerKey: 'do-not-print' }])(
  'rejects absent or invalid database configuration without including credentials', (config) => {
    expect(() => createServerDb(config)).toThrow(/^CONFIG_UNAVAILABLE$/);
  },
);

it('does not turn an RPC database error into success', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
    code: 'XX000', message: 'database unavailable', details: null, hint: null,
  }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
  const db = createServerDb({ supabaseUrl: 'http://127.0.0.1:55321', supabaseServerKey: 'local-test-only' });
  const response = await db.rpc('consume_access_attempt', { p_ip_hash: 'test-hash' });
  expect(response.data).toBeNull();
  expect(response.error?.code).toBe('XX000');
});

it.each(['postgresql://postgres:test@127.0.0.1:55322/postgres',
  'postgresql://postgres:test@[::1]:55322/postgres'])('accepts only literal loopback local status: %s', (url) => {
  expect(validateLocalDbStatus({ DB_URL: url })).toBe(url);
});

it.each(['postgresql://postgres:secret@db.example.test:55322/postgres',
  'postgresql://postgres:secret@localhost:55322/postgres',
  'postgresql://postgres:secret@127.0.0.1:5432/postgres',
  'postgresql://postgres:secret@127.0.0.1:55322/production',
  'postgresql://postgres:secret@127.0.0.1:55322/postgres?host=remote.test',
  'https://127.0.0.1:55322/postgres', 'not-a-url'])('rejects unsafe local status without echoing it: %s', (url) => {
  expect(() => validateLocalDbStatus({ DB_URL: url })).toThrow(/^LOCAL_DB_REQUIRED$/);
});

it('rejects absent status instead of falling back to environment database credentials', () => {
  expect(() => validateLocalDbStatus({})).toThrow(/^LOCAL_DB_REQUIRED$/);
});

it.each([['--linked'], ['--db-url', 'postgresql://remote.test'], ['--workdir', '/tmp/other']])(
  'refuses command-line overrides: %s', (...args) => {
    expect(() => validateDbTestArgs(args)).toThrow(/^DB_TEST_ARGUMENTS_NOT_ALLOWED$/);
  },
);

it('pins an explicitly selected Unix socket without inspecting an unrelated context', async () => {
  const env = await createLocalDbCliEnv({ PATH: '/test/bin', DOCKER_HOST: 'unix:///tmp/docker.sock',
    PGHOST: 'remote.test', SUPABASE_ACCESS_TOKEN: 'private-test-value' }, async () => {
    throw new Error('UNEXPECTED_CONTEXT_INSPECTION');
  });
  expect(env).toEqual({ PATH: '/test/bin', DOCKER_HOST: 'unix:///tmp/docker.sock' });
});

it('uses a selected context ahead of DOCKER_HOST, then removes the mutable context override', async () => {
  const inspect = vi.fn(async () => 'unix:///tmp/context-docker.sock');
  const env = await createLocalDbCliEnv({ DOCKER_HOST: 'ssh://ignored.test', DOCKER_CONTEXT: 'local-test',
    DOCKER_CONFIG: '/test/docker-config' }, inspect);
  expect(inspect).toHaveBeenCalledWith({ DOCKER_HOST: 'ssh://ignored.test', DOCKER_CONTEXT: 'local-test',
    DOCKER_CONFIG: '/test/docker-config' });
  expect(env).toEqual({ DOCKER_HOST: 'unix:///tmp/context-docker.sock', DOCKER_CONFIG: '/test/docker-config' });
});

it.each(['ssh://remote.test', 'tcp://192.0.2.1:2375', 'tcp://127.0.0.1:2375',
  'unix://remote.test/docker.sock', 'unix:///tmp/docker.sock?query', ''])('rejects nonlocal or malformed Docker endpoints: %s', async (endpoint) => {
  await expect(createLocalDbCliEnv({ DOCKER_HOST: endpoint }, async () => endpoint))
    .rejects.toThrow(/^LOCAL_DOCKER_REQUIRED$/);
});

it('rejects a default or selected context pointing at a network daemon without connecting to it', async () => {
  await expect(createLocalDbCliEnv({}, async () => 'ssh://remote.test'))
    .rejects.toThrow(/^LOCAL_DOCKER_REQUIRED$/);
  await expect(createLocalDbCliEnv({ DOCKER_CONTEXT: 'remote-test' }, async () => 'tcp://192.0.2.1:2375'))
    .rejects.toThrow(/^LOCAL_DOCKER_REQUIRED$/);
});
