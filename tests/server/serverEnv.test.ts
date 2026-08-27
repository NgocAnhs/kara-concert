// @vitest-environment node
import { expect, it } from 'vitest';
import { loadServerEnv } from '../../scripts/server-env.mjs';
import { startVercelDev } from '../../scripts/dev-full.mjs';

const accessToken = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

it('loads only allowlisted server values and adds explicit loopback local mode', () => {
  expect(loadServerEnv({
    processEnv: { PATH: '/usr/bin', VITE_SUPABASE_URL: 'public-value' },
    tokenText: `IMPORT_ACCESS_TOKEN=${accessToken}\n`,
    serverText: 'APP_ORIGIN=http://127.0.0.1:3000\nIMPORT_ENABLED=false\nGEMINI_MODEL=gemini-3.0-flash\n',
  })).toEqual({
    IMPORT_ACCESS_TOKEN: accessToken,
    APP_ORIGIN: 'http://127.0.0.1:3000',
    IMPORT_ENABLED: 'false',
    GEMINI_MODEL: 'gemini-3.0-flash',
    IMPORT_LOCAL_DEV: 'true',
  });
});

it('does not execute shell-shaped values from local environment files', () => {
  expect(loadServerEnv({
    processEnv: {},
    tokenText: `IMPORT_ACCESS_TOKEN=${accessToken}\n`,
    serverText: 'GEMINI_API_KEY=$(not-a-command)`still-data`\n',
  }).GEMINI_API_KEY).toBe('$(not-a-command)`still-data`');
});

it('rejects a multiline value without echoing its secret', () => {
  const secret = 'never-print-this-secret';
  expect(() => loadServerEnv({
    processEnv: {},
    tokenText: `IMPORT_ACCESS_TOKEN=${accessToken}\n`,
    serverText: `GEMINI_API_KEY=${secret}\nsecond-line\n`,
  })).toThrow('SERVER_ENV_INVALID');
  try {
    loadServerEnv({
      processEnv: {},
      tokenText: `IMPORT_ACCESS_TOKEN=${accessToken}\n`,
      serverText: `GEMINI_API_KEY=${secret}\nsecond-line\n`,
    });
  } catch (error) {
    expect(String(error)).not.toContain(secret);
  }
});

it('rejects duplicate file keys, unknown file keys, and conflicts with an explicit process value', () => {
  expect(() => loadServerEnv({
    processEnv: {},
    tokenText: `IMPORT_ACCESS_TOKEN=${accessToken}\n`,
    serverText: 'APP_ORIGIN=http://127.0.0.1:3000\nAPP_ORIGIN=http://127.0.0.1:3001\n',
  })).toThrow('SERVER_ENV_INVALID');

  expect(() => loadServerEnv({
    processEnv: {},
    tokenText: `IMPORT_ACCESS_TOKEN=${accessToken}\n`,
    serverText: 'UNEXPECTED_KEY=value\n',
  })).toThrow('SERVER_ENV_INVALID');

  expect(() => loadServerEnv({
    processEnv: { APP_ORIGIN: 'http://127.0.0.1:3001' },
    tokenText: `IMPORT_ACCESS_TOKEN=${accessToken}\n`,
    serverText: 'APP_ORIGIN=http://127.0.0.1:3000\n',
  })).toThrow('SERVER_ENV_INVALID');
});

it('uses an explicit process value when the files do not define that key', () => {
  expect(loadServerEnv({
    processEnv: { APP_ORIGIN: 'http://127.0.0.1:3000', PATH: '/usr/bin' },
    tokenText: `IMPORT_ACCESS_TOKEN=${accessToken}\n`,
    serverText: '',
  })).toEqual({
    IMPORT_ACCESS_TOKEN: accessToken,
    APP_ORIGIN: 'http://127.0.0.1:3000',
    IMPORT_LOCAL_DEV: 'true',
  });
});

it('defaults the local origin when no origin is supplied', () => {
  expect(loadServerEnv({
    processEnv: {},
    tokenText: `IMPORT_ACCESS_TOKEN=${accessToken}\n`,
    serverText: '',
  })).toEqual({
    IMPORT_ACCESS_TOKEN: accessToken,
    APP_ORIGIN: 'http://127.0.0.1:3000',
    IMPORT_LOCAL_DEV: 'true',
  });
});

it('starts Vercel only on loopback without putting server values in its arguments', () => {
  const seen: { executable?: string; args?: string[]; options?: Record<string, unknown> } = {};
  const child = { once() {} };
  const result = startVercelDev({
    processEnv: { PATH: '/usr/bin', KEEP_THIS: 'ordinary-process-value' },
    tokenText: `IMPORT_ACCESS_TOKEN=${accessToken}\n`,
    serverText: 'APP_ORIGIN=http://127.0.0.1:3000\n',
    executable: '/tmp/vercel',
    spawnProcess(executable: string, args: string[], options: Record<string, unknown>) {
      seen.executable = executable;
      seen.args = args;
      seen.options = options;
      return child;
    },
  });

  expect(result).toBe(child);
  expect(seen.executable).toBe('/tmp/vercel');
  expect(seen.args).toEqual(['dev', '--listen', '127.0.0.1:3000']);
  expect(seen.args?.join(' ')).not.toContain(accessToken);
  expect(seen.options).toMatchObject({
    shell: false,
    stdio: 'inherit',
    env: {
      KEEP_THIS: 'ordinary-process-value',
      IMPORT_ACCESS_TOKEN: accessToken,
      IMPORT_LOCAL_DEV: 'true',
    },
  });
});

it('rejects a local origin that does not match the loopback listener', () => {
  expect(() => startVercelDev({
    processEnv: {},
    tokenText: `IMPORT_ACCESS_TOKEN=${accessToken}\n`,
    serverText: 'APP_ORIGIN=http://127.0.0.1:3001\n',
    executable: '/tmp/vercel',
    spawnProcess() {
      throw new Error('must not start');
    },
  })).toThrow('LOCAL_SERVER_UNAVAILABLE');
});

it('rejects inherited production mode before launching the local listener', () => {
  expect(() => startVercelDev({
    processEnv: { VERCEL_ENV: 'production' },
    tokenText: `IMPORT_ACCESS_TOKEN=${accessToken}\n`,
    serverText: '',
    executable: '/tmp/vercel',
    spawnProcess() {
      throw new Error('must not start');
    },
  })).toThrow('LOCAL_SERVER_UNAVAILABLE');
});

it('propagates a child close failure and spawn error without exposing the original error', () => {
  const handlers: Record<string, (code?: number | null) => void> = {};
  const child = {
    once(event: string, handler: (code?: number | null) => void) {
      handlers[event] = handler;
    },
  };
  const exitCodes: number[] = [];
  startVercelDev({
    processEnv: {},
    tokenText: `IMPORT_ACCESS_TOKEN=${accessToken}\n`,
    serverText: '',
    executable: '/tmp/vercel',
    spawnProcess() {
      return child;
    },
    setExitCode(code: number) {
      exitCodes.push(code);
    },
  });
  handlers.close(7);
  expect(exitCodes).toEqual([7]);

  const secret = 'do-not-leak-spawn-error';
  expect(() => startVercelDev({
    processEnv: {},
    tokenText: `IMPORT_ACCESS_TOKEN=${accessToken}\n`,
    serverText: '',
    executable: '/tmp/vercel',
    spawnProcess() {
      throw new Error(secret);
    },
  })).toThrow('LOCAL_SERVER_UNAVAILABLE');
  try {
    startVercelDev({
      processEnv: {},
      tokenText: `IMPORT_ACCESS_TOKEN=${accessToken}\n`,
      serverText: '',
      executable: '/tmp/vercel',
      spawnProcess() {
        throw new Error(secret);
      },
    });
  } catch (error) {
    expect(String(error)).not.toContain(secret);
  }
});
