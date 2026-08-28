import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PracticePanel } from '../../src/components/PracticePanel';

const playerProps = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }));

vi.mock('../../src/components/YouTubePracticePlayer', () => ({
  YouTubePracticePlayer: (props: Record<string, unknown>) => {
    playerProps.last = props;
    return <div data-testid="youtube-player" />;
  },
}));

const song = {
  id: 'song', title: 'Practice song', youtubeUrl: 'https://youtu.be/abc123',
  lines: [
    { id: 'a', korean: '첫 줄', vietHan: 'Chọt chul', romanization: 'Cheot jul', meaning: 'Dòng đầu tiên', displayOrder: 0, startSeconds: 2, endSeconds: 4 },
    { id: 'b', korean: '둘째 줄', displayOrder: 1, startSeconds: 4, endSeconds: 6 },
    { id: 'c', korean: '셋째 줄', displayOrder: 2, startSeconds: 6, endSeconds: 8 },
  ],
};

describe('PracticePanel', () => {
  it('shows dedicated player and lyric sections', () => {
    render(<PracticePanel song={song} onBack={vi.fn()} />);

    expect(screen.getByRole('region', { name: 'Trình phát' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Lời bài hát' })).toBeInTheDocument();
  });

  it('shows pronunciation and meaning without Korean lyrics', () => {
    render(<PracticePanel song={song} onBack={vi.fn()} />);

    expect(screen.getByText('Chọt chul')).toBeInTheDocument();
    expect(screen.getByText('Cheot jul')).toBeInTheDocument();
    expect(screen.getByText('Dòng đầu tiên')).toBeInTheDocument();
    expect(screen.queryByText('첫 줄')).not.toBeInTheDocument();
    expect(screen.queryByText('둘째 줄')).not.toBeInTheDocument();
    expect(screen.queryByText('셋째 줄')).not.toBeInTheDocument();
    expect(screen.getByText('Cách đọc tiếng Việt')).toBeInTheDocument();
  });

  it('shows an English-only line as its original reading', () => {
    const englishLine = {
      id: 'english', korean: "I'm coming home", vietHan: "I'm coming home",
      romanization: "I'm coming home", meaning: 'Tôi đang trở về nhà.',
      displayOrder: 0, startSeconds: 1, endSeconds: 3,
    };
    render(<PracticePanel song={{ ...song, lines: [englishLine] }} onBack={vi.fn()} />);

    expect(screen.getAllByText("I'm coming home").length).toBeGreaterThan(0);
  });

  it('shows the AI accuracy warning for an imported song', () => {
    render(<PracticePanel song={{ ...song, source: 'ai' }} onBack={vi.fn()} />);

    expect(screen.getByText(/AI tạo — lời và mốc thời gian có thể chưa chính xác/i)).toBeInTheDocument();
  });

  it('shows a lyric start-end timestamp and lets an authorized editor change each boundary independently', async () => {
    const user = userEvent.setup();
    const onUpdateTimestamps = vi.fn(async () => undefined);
    render(<PracticePanel song={song} onBack={vi.fn()} canEdit onUpdateTimestamps={onUpdateTimestamps} />);

    await user.click(screen.getByRole('button', { name: 'Chỉnh sửa timestamp' }));
    expect(screen.getByText('00:06 - 00:08')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tăng start câu 03 thêm 1 giây' }));
    expect(screen.getByText('00:07 - 00:08')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tăng end câu 03 thêm 1 giây' }));

    expect(screen.getByText('00:07 - 00:09')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cập nhật chỉnh sửa' }));
    expect(onUpdateTimestamps).toHaveBeenCalledWith([
      { id: 'a', startSeconds: 2, endSeconds: 4 },
      { id: 'b', startSeconds: 4, endSeconds: 6 },
      { id: 'c', startSeconds: 7, endSeconds: 9 },
    ]);
  });

  it('keeps player controls usable and discards a draft when editing is closed', async () => {
    const user = userEvent.setup();
    render(<PracticePanel song={song} onBack={vi.fn()} canEdit onUpdateTimestamps={async () => undefined} />);

    await user.click(screen.getByRole('button', { name: 'Chỉnh sửa timestamp' }));
    await user.click(screen.getByRole('radio', { name: '0.75x' }));
    await user.click(screen.getByRole('button', { name: /Chọt chul/i }));
    await user.click(screen.getByRole('button', { name: 'Lặp đoạn' }));
    expect(playerProps.last).toMatchObject({ playbackRate: 0.75, looping: true });
    await user.click(screen.getByRole('button', { name: 'Tăng start câu 03 thêm 1 giây' }));
    await user.click(screen.getByRole('button', { name: 'Thoát chỉnh sửa' }));
    await user.click(screen.getByRole('button', { name: 'Chỉnh sửa timestamp' }));
    expect(screen.getByRole('button', { name: /03.*00:06 - 00:08/i })).toBeInTheDocument();
  });

  it('creates a range from adjacent lyric selections', async () => {
    const user = userEvent.setup();
    render(<PracticePanel song={song} onBack={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Chọt chul/i }));
    await user.click(screen.getByRole('button', { name: /02.*00:04 - 00:06/i }));
    expect(screen.getByText(/đã chọn: 0:02.*0:06/i)).toBeInTheDocument();
  });

  it('rejects a non-adjacent selection', async () => {
    const user = userEvent.setup();
    render(<PracticePanel song={song} onBack={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Chọt chul/i }));
    await user.click(screen.getByRole('button', { name: /03.*00:06 - 00:08/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/liền nhau/i);
  });

  it('lets the visitor choose a playback speed', async () => {
    const user = userEvent.setup();
    render(<PracticePanel song={song} onBack={vi.fn()} />);

    const speedOption = screen.getByRole('radio', { name: '0.75x' });
    await user.click(speedOption);

    expect(speedOption).toBeChecked();
    expect(playerProps.last).toMatchObject({ playbackRate: 0.75 });
  });

  it('scrolls the active lyric into view as playback advances', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });

    render(<PracticePanel song={song} onBack={vi.fn()} />);

    act(() => {
      (playerProps.last?.onCurrentTime as (seconds: number) => void)(5);
    });

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    expect(scrollIntoView.mock.instances[0]).toBe(screen.getByRole('button', { name: /02.*00:04 - 00:06/i }));
  });

  it('distinguishes a selected line that is also playing', async () => {
    const user = userEvent.setup();
    render(<PracticePanel song={song} onBack={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Chọt chul/i }));
    act(() => (playerProps.last?.onCurrentTime as (seconds: number) => void)(3));
    const line = screen.getByRole('button', { name: /Chọt chul/i });
    expect(line).toHaveAttribute('aria-pressed', 'true');
    expect(within(line).getByText('Đang phát')).toBeInTheDocument();
    expect(within(line).getByText('Đã chọn')).toBeInTheDocument();
  });

  it('disables range controls until a line is selected', async () => {
    const user = userEvent.setup();
    render(<PracticePanel song={song} onBack={vi.fn()} />);
    const loop = screen.getByRole('button', { name: 'Lặp đoạn' });
    const once = screen.getByRole('button', { name: 'Phát một lần' });
    expect(loop).toBeDisabled();
    expect(once).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Chọt chul/i }));
    expect(loop).toBeEnabled();
    expect(once).toBeEnabled();
    await user.click(loop);
    expect(loop).toHaveAttribute('aria-pressed', 'true');
    expect(playerProps.last).toMatchObject({ looping: true });
    await user.click(once);
    expect(once).toHaveAttribute('aria-pressed', 'true');
    expect(playerProps.last).toMatchObject({ looping: false });
  });

  it('does not claim to loop after the last selected line is cleared', async () => {
    const user = userEvent.setup();
    render(<PracticePanel song={song} onBack={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Chọt chul/i }));
    await user.click(screen.getByRole('button', { name: 'Lặp đoạn' }));
    expect(screen.getByText('Đang lặp đoạn đã chọn')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Chọt chul/i }));
    expect(screen.queryByText('Đang lặp đoạn đã chọn')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lặp đoạn' })).toBeDisabled();
  });

  it('explains why no lyric range can be selected for a song without lyrics', () => {
    render(<PracticePanel song={{ ...song, lines: [] }} onBack={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/chưa có lời/i);
    expect(screen.getByRole('button', { name: 'Lặp đoạn' })).toBeDisabled();
  });

  it('respects reduced motion when following a lyric', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    render(<PracticePanel song={song} onBack={vi.fn()} />);
    act(() => (playerProps.last?.onCurrentTime as (seconds: number) => void)(5));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center', inline: 'nearest' });
    vi.unstubAllGlobals();
  });

  it('scrolls only the lyric container when it has its own scroll area', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    render(<PracticePanel song={song} onBack={vi.fn()} />);
    const list = screen.getByRole('group', { name: 'Các câu hát' });
    list.style.overflowY = 'auto';
    const line = screen.getByRole('button', { name: /02.*00:04 - 00:06/i });
    Object.defineProperties(list, { clientHeight: { value: 400 }, scrollHeight: { value: 1000 }, offsetTop: { value: 0 } });
    Object.defineProperties(line, { offsetTop: { value: 500 }, clientHeight: { value: 100 } });
    const scrollTo = vi.fn();
    Object.defineProperty(list, 'scrollTo', { value: scrollTo });
    act(() => (playerProps.last?.onCurrentTime as (seconds: number) => void)(5));
    expect(scrollTo).toHaveBeenCalledWith({ top: 350, behavior: 'smooth' });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('keeps the page still when lyrics already fit an independent scroll panel', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    render(<PracticePanel song={song} onBack={vi.fn()} />);
    const list = screen.getByRole('group', { name: 'Các câu hát' });
    list.style.overflowY = 'auto';
    Object.defineProperties(list, { clientHeight: { value: 400 }, scrollHeight: { value: 400 } });
    act(() => (playerProps.last?.onCurrentTime as (seconds: number) => void)(5));
    expect(screen.getByRole('button', { name: /02.*00:04 - 00:06/i })).toHaveAttribute('aria-current', 'true');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
