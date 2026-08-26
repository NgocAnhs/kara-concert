import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../../src/domain/song';

const catalog = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }));
vi.mock('../../src/repositories/songRepository', () => ({ listPublishedSongs: catalog.list }));
vi.mock('../../src/components/YouTubePracticePlayer', () => ({ YouTubePracticePlayer: () => null }));

import { App } from '../../src/app/App';

const song: Song = {
  id: '1', title: 'A practice song', youtubeUrl: 'https://youtu.be/abc123',
  lines: [{ id: 'line', korean: '첫 줄', startSeconds: 2, endSeconds: 4, displayOrder: 0 }],
};

describe('App catalog navigation', () => {
  beforeEach(() => { catalog.list.mockReset(); });

  it('loads the catalog, opens practice, and restores a usable library', async () => {
    const user = userEvent.setup();
    let resolveCatalog!: (songs: Song[]) => void;
    catalog.list.mockReturnValue(new Promise<Song[]>((resolve) => { resolveCatalog = resolve; }));
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent(/đang tải bài hát/i);
    await act(async () => resolveCatalog([song]));
    await user.click(screen.getByRole('button', { name: `Luyện hát ${song.title}` }));
    expect(screen.getByRole('region', { name: 'Lời bài hát' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: song.title })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Về thư viện' }));
    expect(screen.getByRole('searchbox', { name: 'Tìm bài hát' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /thuộc từng câu/i })).toHaveFocus();
  });

  it('shows an actionable Vietnamese error without replacing it with fake songs', async () => {
    catalog.list.mockRejectedValue(new Error('Network failed'));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/kiểm tra kết nối.*tải lại trang/i);
    expect(screen.queryByRole('button', { name: /luyện hát/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('distinguishes an empty catalog from a load failure', async () => {
    catalog.list.mockResolvedValue([]);
    render(<App />);
    await screen.findByRole('heading', { name: /chưa có bài hát/i });
    expect(screen.getByRole('status')).toHaveTextContent(/chưa có bài hát/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
