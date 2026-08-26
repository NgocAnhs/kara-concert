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

    expect(screen.getByText('2 bài hát')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: /tìm bài hát/i }), 'super');
    expect(screen.getByText('Supernova')).toBeInTheDocument();
    expect(screen.queryByText('Drama')).not.toBeInTheDocument();
    expect(screen.getByText('1 bài hát')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /luyện hát supernova/i }));
    expect(onPractice).toHaveBeenCalledWith(songs[0]);
  });

  it('shows an empty message when no song is published', () => {
    render(<SongLibrary songs={[]} onPractice={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/chưa có bài hát/i);
  });

  it('explains an unmatched query and restores results when cleared', async () => {
    const user = userEvent.setup();
    render(<SongLibrary songs={songs} onPractice={vi.fn()} />);
    const search = screen.getByRole('searchbox', { name: /tìm bài hát/i });
    await user.type(search, 'không có');
    expect(screen.getByRole('status')).toHaveTextContent(/không tìm thấy/i);
    expect(screen.queryByRole('button', { name: /luyện hát/i })).not.toBeInTheDocument();
    await user.clear(search);
    expect(screen.getByText('2 bài hát')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /luyện hát/i })).toHaveLength(2);
  });

  it('preserves the complete title without inventing artist metadata', () => {
    render(<SongLibrary songs={[{ ...songs[0], title: 'A title – with a dash' }]} onPractice={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'A title – with a dash' })).toBeInTheDocument();
    expect(screen.queryByText('BIGBANG')).not.toBeInTheDocument();
  });
});
