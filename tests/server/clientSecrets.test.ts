// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanArtifacts, SYNTHETIC_SERVER_SECRETS } from '../../scripts/check-client-secrets.mjs';

const fixtures: string[] = [];

async function fixture(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'client-secret-scan-'));
  fixtures.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('client artifact secret scanner', () => {
  it('reports artifact path and secret type without echoing the sentinel value', async () => {
    const directory = await fixture();
    await mkdir(path.join(directory, 'assets'));
    await writeFile(
      path.join(directory, 'assets', 'client.js.map'),
      JSON.stringify({ sourcesContent: [SYNTHETIC_SERVER_SECRETS.GEMINI_API_KEY] }),
    );

    const findings = await scanArtifacts(directory, SYNTHETIC_SERVER_SECRETS);

    expect(findings).toEqual([{ artifact: 'assets/client.js.map', secretType: 'GEMINI_API_KEY' }]);
    expect(JSON.stringify(findings)).not.toContain(SYNTHETIC_SERVER_SECRETS.GEMINI_API_KEY);
  });

  it('passes a clean artifact tree, including sourcemaps', async () => {
    const directory = await fixture();
    await writeFile(path.join(directory, 'client.js'), 'console.log("public bundle")');
    await writeFile(path.join(directory, 'client.js.map'), JSON.stringify({ sourcesContent: ['clean source'] }));

    await expect(scanArtifacts(directory, SYNTHETIC_SERVER_SECRETS)).resolves.toEqual([]);
  });
});
