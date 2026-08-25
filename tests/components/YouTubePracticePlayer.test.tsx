import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { YouTubePracticePlayer } from '../../src/components/YouTubePracticePlayer';

const setPlaybackRate = vi.fn();

vi.mock('react-youtube', () => ({
  default: ({ onReady }: { onReady(event: { target: unknown }): void }) => {
    onReady({
      target: {
        seekTo: vi.fn(),
        playVideo: vi.fn(),
        getCurrentTime: vi.fn(),
        setPlaybackRate,
      },
    });
    return <div data-testid="youtube-embed" />;
  },
}));

describe('YouTubePracticePlayer', () => {
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

    expect(setPlaybackRate).toHaveBeenCalledWith(0.75);
  });
});
