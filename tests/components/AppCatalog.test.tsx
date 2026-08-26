import { act, render, screen, waitFor } from '@testing-library/react';
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
  beforeEach(() => {
    catalog.list.mockReset();
    window.history.replaceState(null, '', '/');
  });

  it('loads the catalog, opens practice, and restores a usable library', async () => {
    const user = userEvent.setup();
    let resolveCatalog!: (songs: Song[]) => void;
    catalog.list.mockReturnValue(new Promise<Song[]>((resolve) => { resolveCatalog = resolve; }));
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent(/đang tải bài hát/i);
    await act(async () => resolveCatalog([song]));
    await user.click(screen.getByRole('button', { name: `Luyện hát ${song.title}` }));
    expect(window.location.pathname).toBe('/practice/1');
    expect(screen.getByRole('region', { name: 'Lời bài hát' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: song.title })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Về thư viện' }));
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('searchbox', { name: 'Tìm bài hát' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /thuộc từng câu/i })).toHaveFocus();
  });

  it('opens a practice URL directly and restores it after remounting', async () => {
    window.history.replaceState(null, '', '/practice/1');
    catalog.list.mockResolvedValue([song]);
    const firstVisit = render(<App />);
    expect(await screen.findByRole('heading', { name: song.title, level: 1 })).toHaveFocus();
    firstVisit.unmount();
    render(<App />);
    expect(await screen.findByRole('heading', { name: song.title, level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('uses browser Back and Forward to restore the matching page', async () => {
    catalog.list.mockResolvedValue([song]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: `Luyện hát ${song.title}` }));
    act(() => window.history.back());
    expect(await screen.findByRole('searchbox')).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    act(() => window.history.forward());
    expect(await screen.findByRole('heading', { name: song.title, level: 1 })).toHaveFocus();
    expect(window.location.pathname).toBe('/practice/1');
  });

  it('waits for the catalog before declaring a song missing', async () => {
    window.history.replaceState(null, '', '/practice/missing');
    let resolveCatalog!: (songs: Song[]) => void;
    catalog.list.mockReturnValue(new Promise<Song[]>((resolve) => { resolveCatalog = resolve; }));
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent(/đang tải/i);
    expect(screen.queryByRole('heading', { name: /không tìm thấy/i })).not.toBeInTheDocument();
    await act(async () => resolveCatalog([song]));
    expect(screen.getByRole('heading', { name: /không tìm thấy bài hát/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /về thư viện/i })).toHaveAttribute('href', '/');
  });

  it('shows a recoverable 404 for an unknown URL', async () => {
    window.history.replaceState(null, '', '/unknown/page');
    catalog.list.mockResolvedValue([song]);
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('heading', { name: /không tìm thấy trang/i })).toHaveFocus();
    await user.click(screen.getByRole('link', { name: /về thư viện/i }));
    expect(await screen.findByRole('searchbox')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('shows a load error rather than a missing song when a deep link cannot load', async () => {
    window.history.replaceState(null, '', '/practice/1');
    catalog.list.mockRejectedValue(new Error('Network failed'));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/kiểm tra kết nối/i);
    expect(screen.queryByRole('heading', { name: /không tìm thấy/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /về thư viện/i })).toHaveAttribute('href', '/');
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
