import { render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { YouTubePracticePlayer } from '../../src/components/YouTubePracticePlayer';

const player = vi.hoisted(() => ({
  seekTo: vi.fn(),
  playVideo: vi.fn(),
  pauseVideo: vi.fn(),
  getCurrentTime: vi.fn(),
  setPlaybackRate: vi.fn(),
}));

vi.mock('react-youtube', () => ({
  default: ({ onReady }: { onReady(event: { target: unknown }): void }) => {
    useEffect(() => {
      onReady({ target: player });
    }, []);
    return <div data-testid="youtube-embed" />;
  },
}));

describe('YouTubePracticePlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates the YouTube playback rate when the selected speed changes', () => {
    const { rerender } = render(
      <YouTubePracticePlayer
        youtubeUrl="https://youtu.be/abc123"
        range={null}
        looping={false}
        playbackRate={1}
        onCurrentTime={vi.fn()}
      />,
    );

    rerender(
      <YouTubePracticePlayer
        youtubeUrl="https://youtu.be/abc123"
        range={null}
        looping={false}
        playbackRate={0.75}
        onCurrentTime={vi.fn()}
      />,
    );

    expect(player.setPlaybackRate).toHaveBeenCalledWith(0.75);
  });

  it('explains an invalid video URL in Vietnamese', () => {
    render(<YouTubePracticePlayer youtubeUrl="invalid" range={null} looping={false} playbackRate={1} onCurrentTime={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/không thể nhúng/i);
  });

  it('pauses when a one-time lyric range reaches its end', async () => {
    vi.useFakeTimers();
    player.getCurrentTime.mockResolvedValue(4);

    const { rerender } = render(
      <YouTubePracticePlayer
        youtubeUrl="https://youtu.be/abc123"
        range={null}
        looping={false}
        playbackRate={1}
        onCurrentTime={vi.fn()}
      />,
    );

    rerender(
      <YouTubePracticePlayer
        youtubeUrl="https://youtu.be/abc123"
        range={{ startSeconds: 2, endSeconds: 4, lineIds: ['line-1'] }}
        looping={false}
        playbackRate={1}
        onCurrentTime={vi.fn()}
      />,
    );

    await vi.advanceTimersByTimeAsync(100);

    expect(player.pauseVideo).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('reports elapsed time while the full video plays without a lyric selection', async () => {
    vi.useFakeTimers();
    const onCurrentTime = vi.fn();
    player.getCurrentTime.mockResolvedValue(5);

    render(
      <YouTubePracticePlayer
        youtubeUrl="https://youtu.be/abc123"
        range={null}
        looping={false}
        playbackRate={1}
        onCurrentTime={onCurrentTime}
      />,
    );

    await vi.advanceTimersByTimeAsync(100);

    expect(onCurrentTime).toHaveBeenCalledWith(5);
    vi.useRealTimers();
  });
});
