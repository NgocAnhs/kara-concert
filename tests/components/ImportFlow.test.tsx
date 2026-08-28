import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../../src/domain/song';

const catalog = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }));
vi.mock('../../src/repositories/songRepository', () => ({ listPublishedSongs: catalog.list }));
vi.mock('../../src/components/YouTubePracticePlayer', () => ({ YouTubePracticePlayer: () => null }));

import { App } from '../../src/app/App';

const importedSong: Song = {
  id: 'song-2', title: 'Imported song', youtubeUrl: 'https://youtu.be/abc123', source: 'ai',
  lines: [{ id: 'line-1', korean: '영어', vietHan: 'English', romanization: 'English', meaning: 'Tiếng Anh', displayOrder: 0, startSeconds: 0, endSeconds: 2 }],
};

function json(status: number, value?: unknown, headers?: Record<string, string>) {
  return new Response(value === undefined ? null : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('YouTube import flow', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/import');
    catalog.list.mockReset();
    catalog.list.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn());
  });

  it('clears a rejected access token and explains the error in Vietnamese', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(json(200, { unlocked: false }));
    fetchMock.mockResolvedValueOnce(json(401, { error: 'ACCESS_REQUIRED' }));

    render(<App />);
    expect(screen.getByRole('heading', { name: 'Thêm bài từ YouTube' })).toHaveFocus();
    const token = await screen.findByLabelText('Mã truy cập');
    await user.type(token, 'wrong-token');
    await user.click(screen.getByRole('button', { name: 'Mở quyền thêm bài' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Mã truy cập không đúng');
    expect(token).toHaveValue('');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/access');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', credentials: 'same-origin' });
  });

  it('submits the access form with Enter exactly once', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json(200, { unlocked: false }))
      .mockResolvedValueOnce(json(200, { unlocked: true }));

    render(<App />);
    await user.type(await screen.findByLabelText('Mã truy cập'), 'A'.repeat(43));
    await user.keyboard('{Enter}');

    await screen.findByLabelText('Liên kết YouTube');
    expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/access' && (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1);
  });

  it('waits for access status before allowing a YouTube URL to be submitted', async () => {
    let resolveAccess!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((resolve) => { resolveAccess = resolve; }));

    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent(/đang kiểm tra quyền/i);
    expect(screen.queryByLabelText('Liên kết YouTube')).not.toBeInTheDocument();
    await act(async () => resolveAccess(json(200, { unlocked: true, expiresAt: 123 })));
    expect(await screen.findByLabelText('Liên kết YouTube')).toBeInTheDocument();
  });

  it('reopens access and resumes polling the same job after session expiry', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/imports/10000000-0000-4000-8000-000000000001');
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json(200, { unlocked: true, expiresAt: 123 }))
      .mockResolvedValueOnce(json(401, { error: 'ACCESS_REQUIRED' }))
      .mockResolvedValueOnce(json(200, { unlocked: true, expiresAt: 456 }))
      .mockResolvedValueOnce(json(200, {
        jobId: '10000000-0000-4000-8000-000000000001', status: 'checking_video', stage: 'checking_video', deadlineAt: '2026-08-27T10:04:00.000Z',
      }));

    render(<App />);
    const token = await screen.findByLabelText('Mã truy cập');
    await user.type(token, 'A'.repeat(43));
    await user.click(screen.getByRole('button', { name: 'Mở quyền thêm bài' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/imports/10000000-0000-4000-8000-000000000001')).toBe(true));
    expect(window.location.pathname).toBe('/imports/10000000-0000-4000-8000-000000000001');
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/imports' && (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('reloads the catalog before opening the completed imported song', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    catalog.list.mockResolvedValueOnce([]).mockResolvedValueOnce([importedSong]);
    fetchMock
      .mockResolvedValueOnce(json(200, { unlocked: true, expiresAt: 123 }))
      .mockResolvedValueOnce(json(202, { jobId: '10000000-0000-4000-8000-000000000001', status: 'checking_video', statusUrl: '/api/imports/10000000-0000-4000-8000-000000000001' }))
      .mockResolvedValueOnce(json(200, { unlocked: true, expiresAt: 123 }))
      .mockResolvedValueOnce(json(200, {
        jobId: '10000000-0000-4000-8000-000000000001', status: 'completed', stage: 'completed', deadlineAt: '2026-08-27T10:04:00.000Z', songId: 'song-2',
      }));

    render(<App />);
    const url = await screen.findByLabelText('Liên kết YouTube');
    await user.type(url, 'https://youtu.be/1CTced9CMMk');
    await user.click(screen.getByRole('button', { name: 'Thêm bài' }));

    expect(await screen.findByRole('heading', { name: 'Imported song' })).toBeInTheDocument();
    expect(catalog.list).toHaveBeenCalledTimes(2);
    expect(window.location.pathname).toBe('/practice/imported-song');
  });

  it('submits the YouTube URL form with Enter exactly once', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json(200, { unlocked: true }))
      .mockResolvedValueOnce(json(202, { jobId: '10000000-0000-4000-8000-000000000001', status: 'checking_video', statusUrl: '/api/imports/10000000-0000-4000-8000-000000000001' }))
      .mockResolvedValueOnce(json(200, { unlocked: true }))
      .mockResolvedValueOnce(json(200, { jobId: '10000000-0000-4000-8000-000000000001', status: 'checking_video', stage: 'checking_video', deadlineAt: '2026-08-27T10:04:00.000Z' }));

    render(<App />);
    await user.type(await screen.findByLabelText('Liên kết YouTube'), 'https://youtu.be/1CTced9CMMk');
    await user.keyboard('{Enter}');

    await screen.findByText(/đang kiểm tra video/i);
    expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/imports' && (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1);
  });

  it('returns to the library when browser Back is used from import status', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    window.history.replaceState(null, '', '/');
    fetchMock
      .mockResolvedValueOnce(json(200, { unlocked: true, expiresAt: 123 }))
      .mockResolvedValueOnce(json(202, {
        jobId: '10000000-0000-4000-8000-000000000001', status: 'checking_video', statusUrl: '/api/imports/10000000-0000-4000-8000-000000000001',
      }))
      .mockResolvedValueOnce(json(200, { unlocked: true, expiresAt: 123 }))
      .mockResolvedValueOnce(json(200, {
        jobId: '10000000-0000-4000-8000-000000000001', status: 'checking_video', stage: 'checking_video', deadlineAt: '2026-08-27T10:04:00.000Z',
      }));

    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Thêm bài từ YouTube' }));
    await user.type(await screen.findByLabelText('Liên kết YouTube'), 'https://youtu.be/1CTced9CMMk');
    await user.click(screen.getByRole('button', { name: 'Thêm bài' }));
    await waitFor(() => expect(window.location.pathname).toBe('/imports/10000000-0000-4000-8000-000000000001'));

    act(() => window.history.back());

    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(await screen.findByRole('searchbox', { name: 'Tìm bài hát' })).toBeInTheDocument();
  });

  it('explains the concurrent admission limit with its server retry delay', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(200, { unlocked: true }))
      .mockResolvedValueOnce(json(429, { error: 'ACTIVE_LIMIT' }, { 'Retry-After': '75' }));

    render(<App />);
    await user.type(await screen.findByLabelText('Liên kết YouTube'), 'https://youtu.be/1CTced9CMMk');
    await user.click(screen.getByRole('button', { name: 'Thêm bài' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/đang xử lý số tác vụ tối đa.*1 phút 15 giây/i);
    expect(screen.getByRole('button', { name: 'Thêm bài' })).toBeEnabled();
  });

  it('keeps a cached song ID and offers a catalog-only retry until the song appears', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    catalog.list.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([importedSong]);
    fetchMock
      .mockResolvedValueOnce(json(200, { unlocked: true }))
      .mockResolvedValueOnce(json(200, { songId: 'song-2' }));

    render(<App />);
    await user.type(await screen.findByLabelText('Liên kết YouTube'), 'https://youtu.be/1CTced9CMMk');
    await user.click(screen.getByRole('button', { name: 'Thêm bài' }));

    expect(await screen.findByRole('button', { name: 'Tải lại thư viện' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/imports' && (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Tải lại thư viện' }));
    expect(await screen.findByRole('heading', { name: 'Imported song' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/imports' && (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1);
  });

  it('keeps a completed job song ID and retries only the catalog before navigating', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/imports/10000000-0000-4000-8000-000000000001');
    const fetchMock = vi.mocked(fetch);
    catalog.list.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([importedSong]);
    fetchMock
      .mockResolvedValueOnce(json(200, { unlocked: true }))
      .mockResolvedValueOnce(json(200, {
        jobId: '10000000-0000-4000-8000-000000000001', status: 'completed', stage: 'completed', deadlineAt: '2026-08-27T10:04:00.000Z', songId: 'song-2',
      }));

    render(<App />);
    expect(await screen.findByRole('button', { name: 'Tải lại thư viện' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tải lại thư viện' }));
    expect(await screen.findByRole('heading', { name: 'Imported song' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).startsWith('/api/imports') && (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(0);
  });

  it('locks locally and aborts an in-flight status request before logout completes', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/imports/10000000-0000-4000-8000-000000000001');
    let statusSignal: AbortSignal | undefined;
    let resolveLogout!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation((url, init) => {
      if (url === '/api/access' && !init?.method) return Promise.resolve(json(200, { unlocked: true }));
      if (url === '/api/imports/10000000-0000-4000-8000-000000000001') {
        statusSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      }
      if (url === '/api/access' && init?.method === 'DELETE') return new Promise<Response>((resolve) => { resolveLogout = resolve; });
      throw new Error(`Unexpected request ${url}`);
    });

    render(<App />);
    await screen.findByRole('button', { name: 'Đóng quyền thêm bài' });
    await user.click(screen.getByRole('button', { name: 'Đóng quyền thêm bài' }));

    expect(statusSignal?.aborted).toBe(true);
    expect(screen.queryByLabelText('Mã truy cập')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/đang đóng quyền/i);
    expect(screen.queryByText(/Đang lấy trạng thái tác vụ/i)).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[1]).toMatchObject({ method: 'DELETE' });
    await act(async () => resolveLogout(json(204)));
    expect(await screen.findByLabelText('Mã truy cập')).toBeInTheDocument();
  });

  it('keeps the local lock and reports a distinct error when logout DELETE fails', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(200, { unlocked: true }))
      .mockResolvedValueOnce(json(503, { error: 'CONFIG_UNAVAILABLE' }));

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Đóng quyền thêm bài' }));

    expect(await screen.findByLabelText('Mã truy cập')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/quyền đã được khóa trên thiết bị này/i);
    expect(screen.queryByLabelText('Liên kết YouTube')).not.toBeInTheDocument();
  });

  it('does not navigate when a completed catalog reload resolves after the status page unmounts', async () => {
    window.history.replaceState(null, '', '/imports/10000000-0000-4000-8000-000000000001');
    let resolveReload!: (songs: Song[]) => void;
    catalog.list.mockReturnValueOnce(Promise.resolve([])).mockReturnValueOnce(new Promise<Song[]>((resolve) => { resolveReload = resolve; }));
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(200, { unlocked: true }))
      .mockResolvedValueOnce(json(200, {
        jobId: '10000000-0000-4000-8000-000000000001', status: 'completed', stage: 'completed', deadlineAt: '2026-08-27T10:04:00.000Z', songId: 'song-2',
      }));

    const view = render(<App />);
    await screen.findByRole('status');
    view.unmount();
    await act(async () => resolveReload([importedSong]));

    expect(window.location.pathname).toBe('/imports/10000000-0000-4000-8000-000000000001');
  });

  it('polls sequentially at two-second intervals and stops after a terminal status', async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, '', '/imports/10000000-0000-4000-8000-000000000001');
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(json(200, { unlocked: true }))
        .mockResolvedValueOnce(json(200, {
          jobId: '10000000-0000-4000-8000-000000000001', status: 'checking_video', stage: 'checking_video', deadlineAt: '2026-08-27T10:04:00.000Z',
        }))
        .mockResolvedValueOnce(json(200, {
          jobId: '10000000-0000-4000-8000-000000000001', status: 'failed', stage: 'failed', deadlineAt: '2026-08-27T10:04:00.000Z', errorCode: 'PROVIDER_TRANSIENT',
        }));

      render(<App />);
      await act(async () => undefined);
      const statusCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/imports/10000000-0000-4000-8000-000000000001');
      expect(statusCalls()).toHaveLength(1);
      await act(async () => vi.advanceTimersByTimeAsync(1999));
      expect(statusCalls()).toHaveLength(1);
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(statusCalls()).toHaveLength(2);
      await act(async () => vi.advanceTimersByTimeAsync(4000));
      expect(statusCalls()).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });

  it('aborts an in-flight poll when the status route unmounts', async () => {
    window.history.replaceState(null, '', '/imports/10000000-0000-4000-8000-000000000001');
    let statusSignal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation((url, init) => {
      if (url === '/api/access') return Promise.resolve(json(200, { unlocked: true }));
      statusSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });

    const view = render(<App />);
    await waitFor(() => expect(statusSignal).toBeDefined());
    view.unmount();
    expect(statusSignal?.aborted).toBe(true);
  });

  it('shows a status-read server error without treating the job as completed', async () => {
    window.history.replaceState(null, '', '/imports/10000000-0000-4000-8000-000000000001');
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(200, { unlocked: true }))
      .mockResolvedValueOnce(json(503, { error: 'IMPORT_UNAVAILABLE' }));

    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/không thể cập nhật trạng thái/i);
    expect(screen.queryByRole('button', { name: 'Tải lại thư viện' })).not.toBeInTheDocument();
  });

  it.each([
    ['failed', 'VIDEO_UNAVAILABLE', /video không còn công khai|không thể phát/i],
    ['failed', 'PROVIDER_QUOTA', /dịch vụ AI đang hết hạn mức/i],
    ['failed', 'PROVIDER_TIMEOUT', /dịch vụ xử lý đã quá thời gian/i],
    ['failed', 'PROVIDER_TRANSIENT', /dịch vụ xử lý đang tạm thời gián đoạn/i],
    ['expired', 'JOB_EXPIRED', /tác vụ đã hết thời gian xử lý/i],
  ])('explains terminal %s/%s and provides a route to submit a new task', async (status, errorCode, expected) => {
    window.history.replaceState(null, '', '/imports/10000000-0000-4000-8000-000000000001');
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(200, { unlocked: true }))
      .mockResolvedValueOnce(json(200, {
        jobId: '10000000-0000-4000-8000-000000000001', status, stage: status,
        deadlineAt: '2026-08-27T10:04:00.000Z', errorCode,
      }));

    render(<App />);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(expected));
    const action = screen.getByRole('link', { name: /thêm liên kết khác/i });
    expect(action).toHaveAttribute('href', '/import');
  });

  it.each([
    [429, { error: 'RATE_LIMITED' }, { 'Retry-After': '25' }, /25 giây/i],
    [503, { error: 'CONFIG_UNAVAILABLE' }, undefined, /chưa sẵn sàng/i],
  ])('explains access error %i without retrying the token automatically', async (status, body, headers, message) => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(json(200, { unlocked: false })).mockResolvedValueOnce(json(status, body, headers));

    render(<App />);
    await user.type(await screen.findByLabelText('Mã truy cập'), 'A'.repeat(43));
    await user.click(screen.getByRole('button', { name: 'Mở quyền thêm bài' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not overlap a later poll while the current status request is unresolved', async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, '', '/imports/10000000-0000-4000-8000-000000000001');
      vi.mocked(fetch).mockImplementation((url) => {
        if (url === '/api/access') return Promise.resolve(json(200, { unlocked: true }));
        return new Promise<Response>(() => undefined);
      });
      render(<App />);
      await act(async () => undefined);
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/imports/10000000-0000-4000-8000-000000000001')).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });

  it('keeps one stable live status region when a poll repeats the same stage', async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, '', '/imports/10000000-0000-4000-8000-000000000001');
      vi.mocked(fetch)
        .mockResolvedValueOnce(json(200, { unlocked: true }))
        .mockResolvedValueOnce(json(200, { jobId: '10000000-0000-4000-8000-000000000001', status: 'checking_video', stage: 'checking_video', deadlineAt: '2026-08-27T10:04:00.000Z' }))
        .mockResolvedValueOnce(json(200, { jobId: '10000000-0000-4000-8000-000000000001', status: 'checking_video', stage: 'checking_video', deadlineAt: '2026-08-27T10:04:00.000Z' }));
      render(<App />);
      await act(async () => undefined);
      const originalStatus = screen.getByRole('status');
      expect(screen.getAllByRole('status')).toHaveLength(1);
      expect(originalStatus).toHaveTextContent(/đang kiểm tra video/i);
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(screen.getAllByRole('status')).toHaveLength(1);
      expect(screen.getByRole('status')).toBe(originalStatus);
      expect(originalStatus).toHaveTextContent(/đang kiểm tra video/i);
    } finally { vi.useRealTimers(); }
  });

  it('hides prior status after a 401 and reopens the same route without posting an import', async () => {
    window.history.replaceState(null, '', '/imports/10000000-0000-4000-8000-000000000001');
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(200, { unlocked: true }))
      .mockResolvedValueOnce(json(200, {
        jobId: '10000000-0000-4000-8000-000000000001', status: 'checking_video', stage: 'checking_video', deadlineAt: '2026-08-27T10:04:00.000Z',
      }))
      .mockResolvedValueOnce(json(401, { error: 'ACCESS_REQUIRED' }))
      .mockResolvedValueOnce(json(200, { unlocked: true }))
      .mockResolvedValueOnce(json(200, {
        jobId: '10000000-0000-4000-8000-000000000001', status: 'checking_video', stage: 'checking_video', deadlineAt: '2026-08-27T10:04:00.000Z',
      }));
    vi.useFakeTimers();
    try {
      render(<App />);
      await act(async () => undefined);
      expect(screen.getByRole('status')).toHaveTextContent(/đang kiểm tra video/i);
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(screen.getByLabelText('Mã truy cập')).toBeInTheDocument();
      expect(screen.queryByText(/đang kiểm tra video/i)).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Mã truy cập'), { target: { value: 'A'.repeat(43) } });
      fireEvent.click(screen.getByRole('button', { name: 'Mở quyền thêm bài' }));
      await act(async () => undefined);
      expect(window.location.pathname).toBe('/imports/10000000-0000-4000-8000-000000000001');
      expect(vi.mocked(fetch).mock.calls.some(([url, init]) => url === '/api/imports' && (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('remounts a status route with the same ID without creating a new import', async () => {
    window.history.replaceState(null, '', '/imports/10000000-0000-4000-8000-000000000001');
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(200, { unlocked: true }))
      .mockResolvedValueOnce(json(200, { jobId: '10000000-0000-4000-8000-000000000001', status: 'checking_video', stage: 'checking_video', deadlineAt: '2026-08-27T10:04:00.000Z' }))
      .mockResolvedValueOnce(json(200, { unlocked: true }))
      .mockResolvedValueOnce(json(200, { jobId: '10000000-0000-4000-8000-000000000001', status: 'checking_video', stage: 'checking_video', deadlineAt: '2026-08-27T10:04:00.000Z' }));
    const first = render(<App />);
    await act(async () => undefined);
    expect(screen.getByText(/đang kiểm tra video/i)).toBeInTheDocument();
    first.unmount();
    render(<App />);
    await act(async () => undefined);
    expect(screen.getByText(/đang kiểm tra video/i)).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([url, init]) => url === '/api/imports' && (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });
});
