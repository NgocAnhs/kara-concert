import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadServerEnv } from './server-env.mjs';

const LOOPBACK_ORIGIN = 'http://127.0.0.1:3000';

function localServerUnavailable() {
  return new Error('LOCAL_SERVER_UNAVAILABLE');
}

export function startVercelDev({
  processEnv,
  tokenText,
  serverText,
  executable,
  spawnProcess = spawn,
  setExitCode = (code) => { process.exitCode = code; },
}) {
  if (processEnv.VERCEL_ENV === 'production' || processEnv.NODE_ENV === 'production') {
    throw localServerUnavailable();
  }
  const serverEnv = loadServerEnv({ processEnv, tokenText, serverText });
  if (serverEnv.APP_ORIGIN !== LOOPBACK_ORIGIN) throw localServerUnavailable();

  try {
    const child = spawnProcess(executable, ['dev', '--listen', '127.0.0.1:3000'], {
      env: { ...processEnv, ...serverEnv },
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', () => setExitCode(1));
    child.once('close', (code) => {
      if (code !== 0) setExitCode(typeof code === 'number' ? code : 1);
    });
    return child;
  } catch {
    throw localServerUnavailable();
  }
}

function run() {
  const tokenFile = new URL('../.secrets/song-import.env', import.meta.url);
  const serverFile = new URL('../.secrets/server.env', import.meta.url);
  const vercelExecutable = new URL('../node_modules/.bin/vercel', import.meta.url);

  try {
    startVercelDev({
      processEnv: process.env,
      tokenText: readFileSync(tokenFile, 'utf8'),
      serverText: readFileSync(serverFile, 'utf8'),
      executable: fileURLToPath(vercelExecutable),
    });
  } catch {
    console.error('LOCAL_SERVER_UNAVAILABLE');
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) run();
