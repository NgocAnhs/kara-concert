import { render, screen } from '@testing-library/react';
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
    { id: 'a', korean: '첫 줄', vietHan: 'Chọt chul', displayOrder: 0, startSeconds: 2, endSeconds: 4 },
    { id: 'b', korean: '둘째 줄', displayOrder: 1, startSeconds: 4, endSeconds: 6 },
    { id: 'c', korean: '셋째 줄', displayOrder: 2, startSeconds: 6, endSeconds: 8 },
  ],
};

describe('PracticePanel', () => {
  it('shows dedicated player and lyric sections', () => {
    render(<PracticePanel song={song} onBack={vi.fn()} />);

    expect(screen.getByRole('region', { name: /player/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /lyrics/i })).toBeInTheDocument();
  });

  it('shows Vietnamese-friendly pronunciation beneath the Korean lyric', () => {
    render(<PracticePanel song={song} onBack={vi.fn()} />);

    expect(screen.getByText(/đọc kiểu việt: chọt chul/i)).toBeInTheDocument();
  });

  it('creates a range from adjacent lyric selections', async () => {
    const user = userEvent.setup();
    render(<PracticePanel song={song} onBack={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /첫 줄/i }));
    await user.click(screen.getByRole('button', { name: /둘째 줄/i }));
    expect(screen.getByText(/selected: 0:02.*0:06/i)).toBeInTheDocument();
  });

  it('rejects a non-adjacent selection', async () => {
    const user = userEvent.setup();
    render(<PracticePanel song={song} onBack={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /첫 줄/i }));
    await user.click(screen.getByRole('button', { name: /셋째 줄/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/adjacent/i);
  });

  it('lets the visitor choose a playback speed', async () => {
    const user = userEvent.setup();
    render(<PracticePanel song={song} onBack={vi.fn()} />);

    const speedOption = screen.getByRole('radio', { name: '0.75x' });
    await user.click(speedOption);

    expect(speedOption).toBeChecked();
    expect(playerProps.last).toMatchObject({ playbackRate: 0.75 });
  });
});
