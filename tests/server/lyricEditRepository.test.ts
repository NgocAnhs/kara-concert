// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createLyricEditRepository } from '../../server/lyrics/repository';

it('reports an RPC timestamp rejection as invalid input rather than an infrastructure failure', async () => {
  const rpc = vi.fn(async () => ({ data: false, error: null }));
  const maybeSingle = vi.fn(async () => ({ data: { id: 'song' }, error: null }));
  const repository = createLyricEditRepository({ rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) } as never);

  await expect(repository.updateLyrics('song', [{ id: 'line', startSeconds: 1, endSeconds: 3 }]))
    .resolves.toEqual({ updated: false, code: 'INVALID_LYRIC_TIMESTAMPS' });
});
