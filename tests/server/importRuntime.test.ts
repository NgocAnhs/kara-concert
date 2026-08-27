// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { request, response } from './http-fixtures';

const constructors = vi.hoisted(() => ({
  rpc: vi.fn(async (name: string) => name === 'begin_maintenance'
    ? { data: [], error: null }
    : { data: null, error: new Error('unexpected RPC') }),
  createServerDb: vi.fn(() => ({ rpc: constructors.rpc })),
  createImportRepository: vi.fn(() => ({
    admit: vi.fn(), getJob: vi.fn(), getVideoState: vi.fn(), advance: vi.fn(),
    fail: vi.fn(), complete: vi.fn(), completeCached: vi.fn(),
  })),
  createYouTubeProvider: vi.fn(() => ({ fetchVideo: vi.fn() })),
  createGeminiProvider: vi.fn(() => ({ transcribe: vi.fn(), enrich: vi.fn() })),
}));

vi.mock('../../server/db', () => ({ createServerDb: constructors.createServerDb }));
vi.mock('../../server/imports/repository', () => ({ createImportRepository: constructors.createImportRepository }));
vi.mock('../../server/imports/youtube', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../server/imports/youtube')>(),
  createYouTubeProvider: constructors.createYouTubeProvider,
}));
vi.mock('../../server/imports/gemini', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../server/imports/gemini')>(),
  createGeminiProvider: constructors.createGeminiProvider,
}));

import { createRuntimeImportHandler, createRuntimeMaintenanceHandler } from '../../server/runtime';
import importStatusRoute from '../../api/imports/[id]';
import importsRoute from '../../api/imports/index';
import maintenanceRoute from '../../api/internal/maintenance';

const env = {
  IMPORT_ACCESS_TOKEN: 'A'.repeat(43),
  APP_ORIGIN: 'https://app.test',
  IMPORT_ENABLED: 'true',
  GEMINI_MODEL: 'gemini-test',
  GEMINI_API_KEY: 'gemini-test-key',
  YOUTUBE_DATA_API_KEY: 'youtube-test-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVER_KEY: 'server-test-key',
  CRON_SECRET: 'cron-secret',
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());

it('rejects an unauthorized import before constructing database or provider clients', async () => {
  const out = response();

  await importsRoute(request('POST', '{}', { cookie: undefined }), out.res);

  expect(out.status).toBe(401);
  expect(constructors.createServerDb).not.toHaveBeenCalled();
  expect(constructors.createImportRepository).not.toHaveBeenCalled();
  expect(constructors.createYouTubeProvider).not.toHaveBeenCalled();
  expect(constructors.createGeminiProvider).not.toHaveBeenCalled();
});

it('rejects an unauthorized status read before constructing its repository', async () => {
  const out = response(); const req = request('GET', '', { cookie: undefined }); req.query = { id: 'not-a-uuid' };

  await importStatusRoute(req, out.res);

  expect(out.status).toBe(401);
  expect(constructors.createServerDb).not.toHaveBeenCalled();
  expect(constructors.createImportRepository).not.toHaveBeenCalled();
  expect(constructors.createYouTubeProvider).not.toHaveBeenCalled();
  expect(constructors.createGeminiProvider).not.toHaveBeenCalled();
});

it('returns a safe configuration error without constructing runtime clients', async () => {
  const out = response();

  await createRuntimeImportHandler({})(request('POST', '{}', { cookie: undefined }), out.res);

  expect(out.status).toBe(503);
  expect(out.json()).toEqual({ error: 'CONFIG_UNAVAILABLE' });
  expect(constructors.createServerDb).not.toHaveBeenCalled();
  expect(constructors.createImportRepository).not.toHaveBeenCalled();
  expect(constructors.createYouTubeProvider).not.toHaveBeenCalled();
  expect(constructors.createGeminiProvider).not.toHaveBeenCalled();
});

it('rejects a cron request without its separate secret before constructing database or provider clients', async () => {
  const out = response();

  await createRuntimeMaintenanceHandler({})(request('GET', '', { authorization: 'Bearer absent-secret' }), out.res);

  expect(out.status).toBe(503);
  expect(out.json()).toEqual({ error: 'CONFIG_UNAVAILABLE' });
  expect(constructors.createServerDb).not.toHaveBeenCalled();
  expect(constructors.createYouTubeProvider).not.toHaveBeenCalled();
  expect(constructors.createGeminiProvider).not.toHaveBeenCalled();
});

it('runs cron cleanup with imports disabled and without import token or Gemini configuration', async () => {
  vi.unstubAllEnvs();
  vi.stubEnv('IMPORT_ENABLED', 'false');
  vi.stubEnv('CRON_SECRET', 'cron-secret');
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVER_KEY', 'server-test-key');
  const out = response();

  await maintenanceRoute(request('GET', '', {
    authorization: 'Bearer cron-secret', origin: undefined, 'content-type': undefined,
  }), out.res);

  expect(out.status).toBe(200);
  expect(constructors.rpc).toHaveBeenCalledWith('begin_maintenance');
  expect(constructors.createYouTubeProvider).not.toHaveBeenCalled();
  expect(constructors.createGeminiProvider).not.toHaveBeenCalled();
});

it('rejects invalid cron auth before constructing database or provider clients', async () => {
  const out = response();

  await maintenanceRoute(request('GET', '', { authorization: 'Bearer wrong' }), out.res);

  expect(out.status).toBe(401);
  expect(constructors.createServerDb).not.toHaveBeenCalled();
  expect(constructors.createYouTubeProvider).not.toHaveBeenCalled();
  expect(constructors.createGeminiProvider).not.toHaveBeenCalled();
});
