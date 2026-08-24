import { describe, expect, it } from 'vitest';
import { listPublishedSongs } from '../../src/repositories/songRepository';

describe('listPublishedSongs', () => {
  it('returns mapped songs from the public catalog query', async () => {
    const client = {
      from: () => ({
        select: () => ({
          order: () => ({
            order: async () => ({
              data: [
                {
                  id: 'song-1',
                  title: 'Supernova',
                  youtube_url: 'https://youtu.be/abc123',
                  lyric_lines: [],
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    };

    await expect(listPublishedSongs(client)).resolves.toMatchObject([{ title: 'Supernova' }]);
  });

  it('throws a useful error when Supabase rejects the query', async () => {
    const client = {
      from: () => ({
        select: () => ({
          order: () => ({
            order: async () => ({ data: null, error: { message: 'Network unavailable' } }),
          }),
        }),
      }),
    };

    await expect(listPublishedSongs(client)).rejects.toThrow('Could not load published songs');
  });
});
