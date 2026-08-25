// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createStaticHandler } from '../../scripts/static-site-handler.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('createStaticHandler', () => {
  it('serves the built application shell for the root route', async () => {
    const assetDirectory = await mkdtemp(join(tmpdir(), 'concert-practice-assets-'));
    temporaryDirectories.push(assetDirectory);
    await writeFile(join(assetDirectory, 'index.html'), '<main>Concert Practice</main>');

    const handler = createStaticHandler(pathToFileURL(`${assetDirectory}/`));
    const response = await handler(new Request('https://example.com/'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    await expect(response.text()).resolves.toBe('<main>Concert Practice</main>');
  });
});
