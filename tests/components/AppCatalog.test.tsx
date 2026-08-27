import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../../src/domain/song';
import { useCatalog } from '../../src/app/useCatalog';

const catalog = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }));
vi.mock('../../src/repositories/songRepository', () => ({ listPublishedSongs: catalog.list }));
vi.mock('../../src/components/YouTubePracticePlayer', () => ({ YouTubePracticePlayer: () => null }));

import { App } from '../../src/app/App';

const song: Song = {
  id: '1', title: 'A practice song', youtubeUrl: 'https://youtu.be/abc123',
  lines: [{ id: 'line', korean: '첫 줄', startSeconds: 2, endSeconds: 4, displayOrder: 0 }],
};
const probeClient = {} as never;

function CatalogReloadProbe() {
  const { songs, reload } = useCatalog(probeClient);
  return <><button type="button" onClick={() => { void reload().catch(() => undefined); }}>Tải lại catalog</button><p>{songs?.map((entry) => entry.title).join(',') ?? 'Đang tải'}</p></>;
}

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
    expect(window.location.pathname).toBe('/practice/a-practice-song');
    expect(screen.getByRole('region', { name: 'Lời bài hát' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: song.title })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Về thư viện' }));
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('searchbox', { name: 'Tìm bài hát' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /thuộc từng câu/i })).toHaveFocus();
  });

  it('opens a practice URL directly and restores it after remounting', async () => {
    window.history.replaceState(null, '', '/practice/a-practice-song');
    catalog.list.mockResolvedValue([song]);
    const firstVisit = render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { name: song.title, level: 1 })).toHaveFocus());
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
    await waitFor(() => expect(screen.getByRole('heading', { name: song.title, level: 1 })).toHaveFocus());
    expect(window.location.pathname).toBe('/practice/a-practice-song');
  });

  it('replaces legacy ID URLs with the friendly URL without losing query/hash or trapping Back', async () => {
    window.history.pushState(null, '', '/practice/1?source=share#lyrics');
    catalog.list.mockResolvedValue([song]);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { name: song.title, level: 1 })).toHaveFocus());
    await waitFor(() => expect(window.location.pathname).toBe('/practice/a-practice-song'));
    expect(window.location.search).toBe('?source=share');
    expect(window.location.hash).toBe('#lyrics');
    act(() => window.history.back());
    expect(await screen.findByRole('searchbox')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    act(() => window.history.forward());
    await waitFor(() => expect(screen.getByRole('heading', { name: song.title, level: 1 })).toHaveFocus());
    expect(window.location.pathname).toBe('/practice/a-practice-song');
  });

  it.each([
    ['BIGBANG – LOSER', '/practice/bigbang-loser'],
    ['Into the New World', '/practice/into-the-new-world'],
    ['  ĐỪNG   HỎI / EM?!  ', '/practice/dung-hoi-em'],
    ['봄날', '/practice/%EB%B4%84%EB%82%A0'],
    ['🎵 !!!', '/practice/song--1'],
  ])('opens and reloads the friendly URL for %s', async (title, pathname) => {
    catalog.list.mockResolvedValue([{ ...song, title }]);
    const user = userEvent.setup();
    const visit = render(<App />);
    await user.click(await screen.findByRole('button', { name: /luyện hát/i }));
    expect(window.location.pathname).toBe(pathname);
    visit.unmount();
    render(<App />);
    expect(await screen.findByRole('heading', { name: title.trim().replace(/\s+/g, ' '), level: 1 })).toBeInTheDocument();
  });

  it('distinguishes colliding titles regardless of catalog order and refuses an ambiguous bare slug', async () => {
    const first = { ...song, title: 'Đêm' };
    const second = { ...song, id: '2', title: 'Dem' };
    catalog.list.mockResolvedValue([second, first]);
    const user = userEvent.setup();
    const visit = render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Luyện hát Đêm' }));
    expect(window.location.pathname).toBe('/practice/dem--1');
    await user.click(screen.getByRole('button', { name: 'Về thư viện' }));
    await user.click(screen.getByRole('button', { name: 'Luyện hát Dem' }));
    expect(window.location.pathname).toBe('/practice/dem--2');
    visit.unmount();
    catalog.list.mockResolvedValue([first, second]);
    const reload = render(<App />);
    expect(await screen.findByRole('heading', { name: 'Dem', level: 1 })).toBeInTheDocument();
    reload.unmount();
    window.history.replaceState(null, '', '/practice/dem');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /không tìm thấy bài hát/i })).toBeInTheDocument();
  });

  it('does not let a title slug hijack another song’s legacy ID', async () => {
    catalog.list.mockResolvedValue([song, { ...song, id: '2', title: '1' }]);
    const user = userEvent.setup();
    const visit = render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Luyện hát 1' }));
    expect(window.location.pathname).toBe('/practice/1--2');
    visit.unmount();
    window.history.replaceState(null, '', '/practice/1');
    render(<App />);
    expect(await screen.findByRole('heading', { name: song.title, level: 1 })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/practice/a-practice-song');
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

  it('keeps the newest catalog reload when an earlier request resolves later', async () => {
    const user = userEvent.setup();
    let resolveInitial!: (songs: Song[]) => void;
    let resolveReload!: (songs: Song[]) => void;
    catalog.list
      .mockReturnValueOnce(new Promise<Song[]>((resolve) => { resolveInitial = resolve; }))
      .mockReturnValueOnce(new Promise<Song[]>((resolve) => { resolveReload = resolve; }));

    render(<CatalogReloadProbe />);
    await waitFor(() => expect(catalog.list).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Tải lại catalog' }));
    expect(catalog.list).toHaveBeenCalledTimes(2);
    await act(async () => resolveReload([{ ...song, title: 'Newest catalog' }]));
    expect(screen.getByText('Newest catalog')).toBeInTheDocument();
    await act(async () => resolveInitial([{ ...song, title: 'Stale catalog' }]));
    expect(screen.getByText('Newest catalog')).toBeInTheDocument();
    expect(screen.queryByText('Stale catalog')).not.toBeInTheDocument();
  });

  it('does not let an unmounted catalog request overwrite a remounted public library', async () => {
    let resolveOld!: (songs: Song[]) => void;
    catalog.list
      .mockReturnValueOnce(new Promise<Song[]>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce([{ ...song, title: 'Current catalog' }]);

    const oldView = render(<App />);
    oldView.unmount();
    render(<App />);
    expect(await screen.findByText('Current catalog')).toBeInTheDocument();
    await act(async () => resolveOld([{ ...song, title: 'Old catalog' }]));
    expect(screen.getByText('Current catalog')).toBeInTheDocument();
    expect(screen.queryByText('Old catalog')).not.toBeInTheDocument();
  });

  it('keeps the guest catalog after an import logout and returning to the library', async () => {
    const user = userEvent.setup();
    catalog.list.mockResolvedValue([song]);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ unlocked: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })));

    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Thêm bài từ YouTube' }));
    await user.click(await screen.findByRole('button', { name: 'Đóng quyền thêm bài' }));
    await screen.findByLabelText('Mã truy cập');
    act(() => window.history.back());

    expect(await screen.findByRole('button', { name: `Luyện hát ${song.title}` })).toBeInTheDocument();
    expect(catalog.list).toHaveBeenCalledTimes(1);
  });
});
