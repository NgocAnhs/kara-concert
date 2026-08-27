import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);

export function validateDbTestArgs(args) {
  if (args.length !== 0) throw new Error('DB_TEST_ARGUMENTS_NOT_ALLOWED');
}

export function validateLocalDbStatus(status) {
  try {
    const url = new URL(status.DB_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || url.port !== '55322' || url.pathname !== '/postgres'
      || url.username !== 'postgres' || !url.password || url.search || url.hash) {
      throw new Error();
    }
    return status.DB_URL;
  } catch {
    throw new Error('LOCAL_DB_REQUIRED');
  }
}

async function inspectDockerContext(env) {
  // This reads local context metadata; it does not contact the context's daemon.
  const args = ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'];
  if (env.DOCKER_CONTEXT) args.push('--', env.DOCKER_CONTEXT);
  const { stdout } = await execFileAsync('docker', args, { env, timeout: 5000, maxBuffer: 16 * 1024 });
  return stdout.trim();
}

export async function createLocalDbCliEnv(environment, inspectContext = inspectDockerContext) {
  // Do not inherit SUPABASE_*, PG*, database credentials, or workdir overrides.
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG']
    .filter((key) => environment[key] !== undefined).map((key) => [key, environment[key]]));
  try {
    // Docker gives an explicit context precedence over DOCKER_HOST. With neither
    // override, inspect the currently selected context before any Supabase call.
    const endpoint = env.DOCKER_CONTEXT || !env.DOCKER_HOST ? await inspectContext(env) : env.DOCKER_HOST;
    if (typeof endpoint !== 'string' || !/^unix:\/\/\/[^?#\r\n\0]+$/.test(endpoint)) throw new Error();
    const pinnedEnv = { ...env, DOCKER_HOST: endpoint };
    delete pinnedEnv.DOCKER_CONTEXT;
    return pinnedEnv;
  } catch {
    throw new Error('LOCAL_DOCKER_REQUIRED');
  }
}

async function localCli(args, env) {
  try {
    const { stdout } = await execFileAsync(join(root, 'node_modules/.bin/supabase'), args,
      { cwd: root, env, maxBuffer: 4 * 1024 * 1024, timeout: 120_000 });
    return stdout;
  } catch {
    // CLI output may contain local keys or connection strings. Never echo it.
    throw new Error(`LOCAL_CLI_${args[0].toUpperCase()}_FAILED`);
  }
}

async function catalogSnapshot(client) {
  const songs = await client.query('select id, title, youtube_url, status, created_at, updated_at from public.songs order by id');
  const lyrics = await client.query('select * from public.lyric_lines order by id');
  return { songs: songs.rows, lyrics: lyrics.rows };
}

async function checkBackfill(connection, migrations) {
  // Only a database created by this invocation is removed. Existing DBs are never reset.
  const database = `import_migration_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client(connection);
  let scratch;
  let created = false;
  await admin.connect();
  try {
    await admin.query(`create database "${database}"`);
    created = true;
    scratch = new pg.Client({ ...connection, database });
    await scratch.connect();
    for (const name of migrations.filter((name) => /^00[1-4]_/.test(name))) {
      await scratch.query(await readFile(join(root, 'supabase/migrations', name), 'utf8'));
    }
    const fixtures = [
      ['backfill-watch', 'https://www.youtube.com/watch?si=track&v=aaaaaaaaaaa&t=2', 'aaaaaaaaaaa'],
      ['backfill-short', 'https://youtu.be/bbbbbbbbbbb?si=track', 'bbbbbbbbbbb'],
      ['backfill-shorts', 'https://m.youtube.com/shorts/ccccccccccc', 'ccccccccccc'],
      ['backfill-embed', 'https://youtube.com/embed/ddddddddddd#tracking', 'ddddddddddd'],
      ['backfill-impostor', 'https://youtube.com.example.test/watch?v=eeeeeeeeeee', null],
      ['backfill-credentials', 'https://user@youtube.com/watch?v=eeeeeeeeeee', null],
      ['backfill-port', 'https://youtube.com:8443/watch?v=eeeeeeeeeee', null],
      ['backfill-playlist', 'https://youtube.com/watch?v=eeeeeeeeeee&list=PLtest', null],
      ['backfill-empty-list', 'https://youtube.com/watch?v=eeeeeeeeeee&list', null],
      ['backfill-encoded-list', 'https://youtube.com/watch?v=eeeeeeeeeee&%6cist=PLtest', null],
      ['backfill-duplicate-v', 'https://youtube.com/watch?v=eeeeeeeeeee&v=fffffffffff', null],
      ['backfill-bare-duplicate-v', 'https://youtube.com/watch?v=eeeeeeeeeee&v', null],
      ['backfill-short-duplicate-v', 'https://youtu.be/eeeeeeeeeee?v=eeeeeeeeeee&v=fffffffffff', null],
      ['backfill-short-second-question-list', 'https://youtu.be/ggggggggggg?x=?&list', null],
      ['backfill-watch-second-question-list', 'https://youtube.com/watch?v=hhhhhhhhhhh&x=?&list', null],
      ['backfill-short-second-question-v', 'https://youtu.be/iiiiiiiiiii?x=?&v=ignored&v', null],
      ['backfill-watch-second-question-v', 'https://youtube.com/watch?v=jjjjjjjjjjj&x=?&v', null],
      ['backfill-short-question-tracking', 'https://youtu.be/kkkkkkkkkkk?x=?&si=tracking', 'kkkkkkkkkkk'],
      ['backfill-http', 'http://youtube.com/watch?v=eeeeeeeeeee', null],
      ['backfill-invalid-id', 'https://youtu.be/legacy', null],
      ['backfill-collision', 'https://youtu.be/aaaaaaaaaaa', 'aaaaaaaaaaa'],
    ];
    for (const [title, url] of fixtures) {
      await scratch.query('insert into public.songs(title, youtube_url) values ($1, $2)', [title, url]);
    }
    const beforeCollision = await catalogSnapshot(scratch);
    const migration = await readFile(join(root, 'supabase/migrations/005_import_storage.sql'), 'utf8');
    await assert.rejects(scratch.query(migration), { code: '23505', message: 'DUPLICATE_YOUTUBE_VIDEO_ID' });
    await scratch.query('rollback');
    const columns = await scratch.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'songs' and column_name = 'youtube_video_id'");
    assert.equal(columns.rowCount, 0, 'collision rolls back the entire migration');
    assert.deepEqual(await catalogSnapshot(scratch), beforeCollision, 'collision preserves all catalog data');
    await scratch.query("delete from public.songs where title = 'backfill-collision'");
    const before = await catalogSnapshot(scratch);
    await scratch.query(migration);
    assert.deepEqual(await catalogSnapshot(scratch), before, 'backfill preserves titles, URLs, timestamps and lyrics');
    for (const [title, , expected] of fixtures.filter(([title]) => title !== 'backfill-collision')) {
      const result = await scratch.query('select youtube_video_id from public.songs where title = $1', [title]);
      assert.equal(result.rows[0].youtube_video_id, expected, title);
    }
    await assert.rejects(scratch.query("insert into public.songs(title, youtube_url, youtube_video_id) values ('duplicate', 'https://youtu.be/aaaaaaaaaaa', 'aaaaaaaaaaa')"), { code: '23505' });
    console.log('PASS migration backfill, strict URL fixtures, collision rollback, catalog preservation, unique index');
  } finally {
    if (scratch) await scratch.end();
    if (created) await admin.query(`drop database "${database}"`);
    await admin.end();
  }
}

async function checkConcurrentAccess(connection, admin) {
  const ipHash = `concurrency-test-${randomUUID()}`;
  const clients = Array.from({ length: 15 }, () => new pg.Client(connection));
  try {
    await Promise.all(clients.map((client) => client.connect()));
    await Promise.all(clients.map((client) => client.query('set role service_role')));
    const results = await Promise.all(clients.map((client) => client.query(
      'select * from public.consume_access_attempt($1)', [ipHash],
    )));
    assert.equal(results.filter((result) => result.rows[0].allowed).length, 10);
    assert.equal(results.filter((result) => !result.rows[0].allowed).length, 5);
    const stored = await admin.query('select count(*)::int as count from public.access_attempts where ip_hash = $1', [ipHash]);
    assert.equal(stored.rows[0].count, 10);
    console.log('PASS 15 simultaneous real service_role calls: exactly 10 allowed, 5 denied');
  } finally {
    await Promise.allSettled(clients.map((client) => client.end()));
    await admin.query('delete from public.access_attempts where ip_hash = $1', [ipHash]);
  }
}

async function runPgtap(client) {
  await client.query('create schema if not exists extensions');
  await client.query('create extension if not exists pgtap with schema extensions');
  const tests = (await readdir(join(root, 'supabase/tests'))).filter((name) => name.endsWith('.test.sql')).sort();
  for (const name of tests) {
    const result = await client.query(await readFile(join(root, 'supabase/tests', name), 'utf8'));
    const tap = (Array.isArray(result) ? result : [result]).flatMap((part) => part.rows)
      .flatMap((row) => Object.values(row)).filter((line) => typeof line === 'string');
    const assertions = tap.filter((line) => /^ok \d+/.test(line));
    const plan = tap.find((line) => /^1\.\.\d+$/.test(line));
    const failures = tap.filter((line) => /^not ok \d+/.test(line));
    if (failures.length) console.error(`FAILED ${name}: ${failures.map((line) => line.replace(/[^A-Za-z0-9 _.,:'()/-]/g, '?')).join(' | ')}`);
    assert.ok(!tap.some((line) => /^not ok|^Bail out!/m.test(line)), `${name}: pgTAP assertion failed`);
    assert.ok(plan && Number(plan.slice(3)) === assertions.length, `${name}: incomplete pgTAP plan`);
    console.log(`PASS ${name}: ${assertions.length} real PostgreSQL assertions`);
  }
}

async function runImportConcurrency(url) {
  const childEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR']
    .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  childEnv.DB_TEST_URL = url.toString();
  try {
    const { stdout } = await execFileAsync(join(root, 'node_modules/.bin/vitest'),
      ['--config', 'vitest.db.config.ts', '--run'], {
        cwd: root, env: childEnv, maxBuffer: 4 * 1024 * 1024, timeout: 120_000,
      });
    process.stdout.write(stdout);
  } catch (error) {
    const password = decodeURIComponent(url.password);
    const safe = `${error.stdout || ''}${error.stderr || ''}`
      .replaceAll(url.toString(), '[LOCAL_DB_URL]').replaceAll(password, '[LOCAL_DB_PASSWORD]');
    process.stderr.write(safe);
    throw new Error('LOCAL_DB_VITEST_FAILED');
  }
}

async function main() {
  validateDbTestArgs(process.argv.slice(2));
  const config = await readFile(join(root, 'supabase/config.toml'), 'utf8');
  if (!/^project_id\s*=\s*"concert-practice-import-test"\s*$/m.test(config)) {
    throw new Error('LOCAL_TEST_PROJECT_REQUIRED');
  }
  const cliEnv = await createLocalDbCliEnv(process.env);
  const url = new URL(validateLocalDbStatus(JSON.parse(await localCli(['status', '--output', 'json'], cliEnv))));
  const connection = {
    host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port), database: 'postgres',
    user: 'postgres', password: decodeURIComponent(url.password), ssl: false, connectionTimeoutMillis: 5000,
  };
  const migrations = (await readdir(join(root, 'supabase/migrations'))).filter((name) => name.endsWith('.sql')).sort();
  const listed = await localCli(['migration', 'list', '--local'], cliEnv);
  for (const name of migrations) {
    const version = name.split('_')[0];
    if (!new RegExp(`\\b${version}\\b`).test(listed)) throw new Error('CLI_MIGRATION_FILENAME_NOT_RECOGNIZED');
  }
  console.log('PASS CLI recognizes unchanged migration filenames');
  const client = new pg.Client(connection);
  let scratch;
  let scratchCreated = false;
  const scratchDatabase = `import_jobs_test_${randomUUID().replaceAll('-', '')}`;
  await client.connect();
  try {
    const before = await catalogSnapshot(client);
    await localCli(['migration', 'up', '--local'], cliEnv);
    assert.deepEqual(await catalogSnapshot(client), before, 'migration preserves existing catalog fields and lyrics');
    console.log('PASS local migration up; catalog contents unchanged');

    await client.query(`create database "${scratchDatabase}"`);
    scratchCreated = true;
    scratch = new pg.Client({ ...connection, database: scratchDatabase });
    await scratch.connect();
    for (const name of migrations) {
      await scratch.query(await readFile(join(root, 'supabase/migrations', name), 'utf8'));
    }
    console.log(`PASS fresh scratch database replayed migrations ${migrations[0].slice(0, 3)}-${migrations.at(-1).slice(0, 3)} without reset or history repair`);
    await runPgtap(scratch);
    await checkConcurrentAccess({ ...connection, database: scratchDatabase }, scratch);
    const scratchUrl = new URL(url);
    scratchUrl.pathname = `/${scratchDatabase}`;
    await runImportConcurrency(scratchUrl);
    await checkBackfill(connection, migrations);
  } finally {
    if (scratch) await scratch.end();
    if (scratchCreated) await client.query(`drop database "${scratchDatabase}"`);
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Never print raw errors, query parameters, CLI status or connection URLs.
    const known = /^(?:DB_TEST_ARGUMENTS_NOT_ALLOWED|LOCAL_[A-Z_]+|CLI_MIGRATION_FILENAME_NOT_RECOGNIZED)$/;
    const safeConstraint = typeof error.constraint === 'string' && /^[A-Za-z0-9_]+$/.test(error.constraint)
      ? `: ${error.constraint}` : '';
    console.error(known.test(error.message) ? error.message : `LOCAL_DB_TEST_FAILED${error.code ? ` (${error.code})` : ''}${safeConstraint}`);
    console.error('Database verification did not pass. Start the isolated loopback Supabase stack; do not use a remote database or reset an existing database.');
    process.exitCode = 1;
  });
}
