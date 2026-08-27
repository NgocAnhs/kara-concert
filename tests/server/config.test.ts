// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { readServerConfig } from '../../server/config';

const accessToken = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

it('refuses a missing access secret without exposing configuration values', () => {
  expect(() => readServerConfig({ APP_ORIGIN: 'http://127.0.0.1:3000' }))
    .toThrow('CONFIG_UNAVAILABLE');
});

it('refuses an origin that is not a trusted origin', () => {
  expect(() => readServerConfig({
    IMPORT_ACCESS_TOKEN: accessToken,
    APP_ORIGIN: 'https://example.test/imports',
  })).toThrow('CONFIG_UNAVAILABLE');
});

it('rejects HTTP origins except an explicit non-production loopback mode', () => {
  expect(() => readServerConfig({
    IMPORT_ACCESS_TOKEN: accessToken,
    APP_ORIGIN: 'http://example.test',
    IMPORT_LOCAL_DEV: 'true',
  })).toThrow('CONFIG_UNAVAILABLE');

  expect(() => readServerConfig({
    IMPORT_ACCESS_TOKEN: accessToken,
    APP_ORIGIN: 'http://127.0.0.1:3000',
    IMPORT_LOCAL_DEV: 'true',
    VERCEL_ENV: 'production',
  })).toThrow('CONFIG_UNAVAILABLE');
});

it('keeps importing disabled by default in explicit local mode', () => {
  expect(readServerConfig({
    IMPORT_ACCESS_TOKEN: accessToken,
    APP_ORIGIN: 'http://127.0.0.1:3000/',
    IMPORT_LOCAL_DEV: 'true',
  })).toMatchObject({
    importAccessToken: accessToken,
    appOrigin: 'http://127.0.0.1:3000',
    importEnabled: false,
    localDev: true,
  });
});

it('fails closed when import is enabled without its provider and database configuration', () => {
  expect(() => readServerConfig({
    IMPORT_ACCESS_TOKEN: accessToken,
    APP_ORIGIN: 'http://127.0.0.1:3000',
    IMPORT_ENABLED: 'true',
    GEMINI_MODEL: 'gemini-3.0-flash',
  })).toThrow('CONFIG_UNAVAILABLE');
});

it('requires an explicitly configured Gemini model before enabled imports can start', () => {
  expect(() => readServerConfig({
    IMPORT_ACCESS_TOKEN: accessToken,
    APP_ORIGIN: 'https://example.test',
    IMPORT_ENABLED: 'true',
    GEMINI_API_KEY: 'gemini-test-key',
    YOUTUBE_DATA_API_KEY: 'youtube-test-key',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVER_KEY: 'server-test-key',
  })).toThrow('CONFIG_UNAVAILABLE');
});

it('accepts a fully configured enabled import feature', () => {
  expect(readServerConfig({
    IMPORT_ACCESS_TOKEN: accessToken,
    APP_ORIGIN: 'https://example.test',
    IMPORT_ENABLED: 'true',
    GEMINI_MODEL: 'gemini-3.0-flash',
    GEMINI_API_KEY: 'gemini-test-key',
    YOUTUBE_DATA_API_KEY: 'youtube-test-key',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVER_KEY: 'server-test-key',
  })).toMatchObject({
    importEnabled: true,
    geminiModel: 'gemini-3.0-flash',
  });
});

it('refuses local mode on a Vercel preview deployment', () => {
  expect(() => readServerConfig({
    IMPORT_ACCESS_TOKEN: 'A'.repeat(43), APP_ORIGIN: 'http://127.0.0.1:3000',
    IMPORT_LOCAL_DEV: 'true', VERCEL_ENV: 'preview',
  })).toThrow('CONFIG_UNAVAILABLE');
});

it('selects Node 24 through package engines while retaining the 300-second API duration', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));

  expect(packageJson.engines).toEqual({ node: '24.x' });
  expect(vercel.functions['api/**/*.ts']).toEqual({ maxDuration: 300 });
});
