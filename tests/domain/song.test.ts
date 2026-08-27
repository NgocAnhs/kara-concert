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

  it('keeps Vietnamese-friendly Korean pronunciation from the catalog', () => {
    const songs = parsePublishedSongs([
      {
        id: 'song-1',
        title: 'LOSER',
        youtube_url: 'https://youtu.be/abc123',
        lyric_lines: [
          {
            id: 'line-1',
            korean: 'LOSER',
            viet_han: 'Lu zờ',
            display_order: 0,
            start_seconds: 0,
            end_seconds: 1,
          },
        ],
      },
    ]);

    expect(songs[0].lines[0].vietHan).toBe('Lu zờ');
  });

  it('treats catalog songs without a provenance field as manual', () => {
    const [song] = parsePublishedSongs([
      {
        id: 'song-1',
        title: 'Existing song',
        youtube_url: 'https://youtu.be/abc123',
        lyric_lines: [],
      },
    ]);

    expect(song.source).toBe('manual');
  });

  it('keeps the original lyric text without trimming transcript whitespace', () => {
    const [song] = parsePublishedSongs([
      {
        id: 'song-1', title: 'Preserve transcript', youtube_url: 'https://youtu.be/abc123',
        lyric_lines: [{ id: 'line-1', korean: '  I\'m coming home  ', display_order: 0, start_seconds: 0, end_seconds: 1 }],
      },
    ]);

    expect(song.lines[0].korean).toBe('  I\'m coming home  ');
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
