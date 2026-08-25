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
});
