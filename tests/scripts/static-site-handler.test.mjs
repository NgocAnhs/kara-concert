// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createStaticHandler } from '../../scripts/static-site-handler.mjs';

describe('createStaticHandler', () => {
  it('forwards requests to the hosting asset binding', async () => {
    const request = new Request('https://example.com/');
    const assetFetch = vi.fn().mockResolvedValue(new Response('<main>Concert Practice</main>'));
    const handler = createStaticHandler();

    const response = await handler.fetch(request, { ASSETS: { fetch: assetFetch } });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('<main>Concert Practice</main>');
    expect(assetFetch).toHaveBeenCalledWith(request);
  });

  it.each(['/practice/song-1', '/unknown/page'])('serves the SPA for a direct page request to %s', async (pathname) => {
    const handler = createStaticHandler();
    const response = await handler.fetch(new Request(`https://example.com${pathname}?ref=share`, {
      headers: { Accept: 'text/html' },
    }), { ASSETS: { fetch: async (request) => new URL(request.url).pathname === '/index.html'
      ? new Response('<main>Concert Practice</main>')
      : new Response('Not found', { status: 404 }) } });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Concert Practice');
  });

  it.each([
    ['/assets/missing.js', 'GET', '*/*'],
    ['/assets/missing.js', 'GET', 'text/html'],
    ['/practice/song-1', 'POST', 'text/html'],
    ['/practice/song-1', 'GET', 'application/json'],
  ])('does not turn missing assets or non-navigation requests into HTML: %s %s %s', async (pathname, method, accept) => {
    const response = await createStaticHandler().fetch(new Request(`https://example.com${pathname}`, {
      method, headers: { Accept: accept },
    }), { ASSETS: { fetch: async (request) => new URL(request.url).pathname === '/index.html'
      ? new Response('<main>Wrong fallback</main>')
      : new Response('Not found', { status: 404 }) } });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
  });
});
