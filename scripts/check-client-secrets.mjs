import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');

export const SYNTHETIC_SERVER_SECRETS = Object.freeze({
  IMPORT_ACCESS_TOKEN: 'codex_fake_import_access_7RCp3B0YsM4tN6uQ8vW1xZ5aD9fH2jK',
  GEMINI_API_KEY: 'codex_fake_gemini_4Wm8Qp2Ry6Tk9Vn3Xs7Za1Bc5De0FgHu',
  YOUTUBE_DATA_API_KEY: 'codex_fake_youtube_9Hs3Jk7Lm1Np5Qr8St2Uv6Wx0Yz4AbCd',
  SUPABASE_URL: 'https://codex-fake-server-only.supabase.invalid',
  SUPABASE_SERVER_KEY: 'codex_fake_supabase_server_6Kn2Pt8Rv4Xy0Za5Bc9De3Fg7Hj1LmQs',
  CRON_SECRET: 'codex_fake_cron_1Df5Gh9Jk3Lm7Np2Qr6St0Vw4Xy8ZaBc',
});

async function artifactFiles(directory, relative = '') {
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await artifactFiles(directory, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

export async function scanArtifacts(directory, secrets = SYNTHETIC_SERVER_SECRETS) {
  const findings = [];
  for (const artifact of await artifactFiles(directory)) {
    const contents = await readFile(path.join(directory, artifact));
    for (const [secretType, secretValue] of Object.entries(secrets)) {
      if (contents.includes(Buffer.from(secretValue))) findings.push({ artifact, secretType });
    }
  }
  return findings;
}

function runBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'build'], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ...SYNTHETIC_SERVER_SECRETS },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal || code !== 0) reject(new Error('SYNTHETIC_BUILD_FAILED'));
      else resolve();
    });
  });
}

async function run() {
  if (process.argv.length !== 2) throw new Error('USAGE');
  await runBuild();
  const findings = await scanArtifacts(path.join(PROJECT_ROOT, 'dist'));
  if (findings.length > 0) {
    for (const finding of findings) console.error(`${finding.artifact}: ${finding.secretType}`);
    process.exitCode = 1;
  } else {
    console.log('Client artifact secret scan passed.');
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : 'CLIENT_SECRET_SCAN_FAILED');
    process.exitCode = 1;
  });
}
