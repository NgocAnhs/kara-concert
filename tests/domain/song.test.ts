import { describe, expect, it } from 'vitest';
import { parsePublishedSongs } from '../../src/domain/song';

describe('parsePublishedSongs', () => {
  it('maps valid database rows and sorts lyrics by display order', () => {
    const songs = parsePublishedSongs([
      {
        id: 'song-1',
        title: 'Supernova',
        youtube_url: 'https://youtu.be/abc123',
        lyric_lines: [
          { id: 'line-2', korean: '둘', display_order: 1, start_seconds: 2, end_seconds: 3 },
          { id: 'line-1', korean: '하나', display_order: 0, start_seconds: 0, end_seconds: 1 },
        ],
      },
    ]);

    expect(songs[0].lines.map((line) => line.korean)).toEqual(['하나', '둘']);
  });

  it('rejects a lyric line ending before it starts', () => {
    expect(() =>
      parsePublishedSongs([
        {
          id: 'song-1',
          title: 'Bad timing',
          youtube_url: 'https://youtu.be/abc123',
          lyric_lines: [{ id: 'line-1', korean: '안녕', display_order: 0, start_seconds: 2, end_seconds: 1 }],
        },
      ]),
    ).toThrow();
  });
});
