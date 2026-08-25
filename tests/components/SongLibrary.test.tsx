import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SongLibrary } from '../../src/components/SongLibrary';
import type { Song } from '../../src/domain/song';

const songs: Song[] = [
  { id: '1', title: 'Supernova', youtubeUrl: 'https://youtu.be/abc123', lines: [] },
  { id: '2', title: 'Drama', youtubeUrl: 'https://youtu.be/def456', lines: [] },
];

describe('SongLibrary', () => {
  it('filters published songs by title and opens practice', async () => {
    const user = userEvent.setup();
    const onPractice = vi.fn();
    render(<SongLibrary songs={songs} onPractice={onPractice} />);

    expect(screen.getByText(/2 songs ready to practice/i)).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: /search songs/i }), 'super');
    expect(screen.getByText('Supernova')).toBeInTheDocument();
    expect(screen.queryByText('Drama')).not.toBeInTheDocument();
    expect(screen.getByText(/1 song ready to practice/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /practice supernova/i }));
    expect(onPractice).toHaveBeenCalledWith(songs[0]);
  });

  it('shows an empty message when no song is published', () => {
    render(<SongLibrary songs={[]} onPractice={vi.fn()} />);
    expect(screen.getByText(/no songs published/i)).toBeInTheDocument();
  });
});
