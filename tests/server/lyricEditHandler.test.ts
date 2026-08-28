// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readServerConfig } from '../../server/config';
import { createSession } from '../../server/access/session';
import { createLyricEditHandler } from '../../server/lyrics/handler';
import { request, response } from './http-fixtures';

const token = 'A'.repeat(43);
const config = readServerConfig({ IMPORT_ACCESS_TOKEN: token, APP_ORIGIN: 'https://app.test', IMPORT_ENABLED: 'false' });
const cookie = `song_import_session=${createSession(token, 1000)}`;
const songId = '10000000-0000-4000-8000-000000000001';

describe('PATCH /api/songs/:id/lyrics', () => {
  it('requires the import-token session before accepting timestamp edits', async () => {
    const updateLyrics = vi.fn();
    const out = response(); const req = request('PATCH', '{}', { cookie: undefined }); req.query = { id: songId };

    await createLyricEditHandler({ config, updateLyrics, nowSeconds: () => 1000 })(req, out.res);

    expect(out.status).toBe(401);
    expect(updateLyrics).not.toHaveBeenCalled();
  });

  it('allows a complete lyric update with overlapping ranges and passes it to the repository', async () => {
    const updateLyrics = vi.fn(async () => ({ updated: true } as const));
    const out = response();
    const req = request('PATCH', JSON.stringify({ lines: [
      { id: '20000000-0000-4000-8000-000000000001', startSeconds: 1, endSeconds: 3 },
      { id: '20000000-0000-4000-8000-000000000002', startSeconds: 2, endSeconds: 6 },
    ] }), { cookie, origin: 'https://app.test' });
    req.query = { id: songId };

    await createLyricEditHandler({ config, updateLyrics, nowSeconds: () => 1000 })(req, out.res);

    expect(out.status).toBe(200);
    expect(updateLyrics).toHaveBeenCalledWith(songId, [
      { id: '20000000-0000-4000-8000-000000000001', startSeconds: 1, endSeconds: 3 },
      { id: '20000000-0000-4000-8000-000000000002', startSeconds: 2, endSeconds: 6 },
    ]);
  });

  it('accepts an update containing 90 lyric timestamps', async () => {
    const lines = Array.from({ length: 90 }, (_, index) => ({
      id: `20000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
      startSeconds: index * 2,
      endSeconds: index * 2 + 1,
    }));
    const out = response();
    const req = request('PATCH', JSON.stringify({ lines }), { cookie, origin: 'https://app.test' }); req.query = { id: songId };

    await createLyricEditHandler({ config, updateLyrics: async () => ({ updated: true }), nowSeconds: () => 1000 })(req, out.res);

    expect(out.status).toBe(200);
  });

  it('reports a distinct error when the database rejects a lyric update', async () => {
    const out = response();
    const req = request('PATCH', JSON.stringify({ lines: [
      { id: '20000000-0000-4000-8000-000000000001', startSeconds: 1, endSeconds: 3 },
    ] }), { cookie, origin: 'https://app.test' }); req.query = { id: songId };

    await createLyricEditHandler({ config, updateLyrics: async () => ({ updated: false, code: 'INVALID_LYRIC_TIMESTAMPS' }), nowSeconds: () => 1000 })(req, out.res);

    expect(out.status).toBe(400);
    expect(out.json()).toEqual({ error: 'INVALID_LYRIC_TIMESTAMPS' });
  });

  it('rejects duplicate start timestamps before the repository is called', async () => {
    const updateLyrics = vi.fn();
    const out = response();
    const req = request('PATCH', JSON.stringify({ lines: [
      { id: '20000000-0000-4000-8000-000000000001', startSeconds: 1, endSeconds: 3 },
      { id: '20000000-0000-4000-8000-000000000002', startSeconds: 1, endSeconds: 4 },
    ] }), { cookie, origin: 'https://app.test' });
    req.query = { id: songId };

    await createLyricEditHandler({ config, updateLyrics, nowSeconds: () => 1000 })(req, out.res);

    expect(out.status).toBe(400);
    expect(out.json()).toEqual({ error: 'INVALID_LYRIC_TIMESTAMPS' });
    expect(updateLyrics).not.toHaveBeenCalled();
  });

});
