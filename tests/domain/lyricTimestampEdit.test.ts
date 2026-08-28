import { describe, expect, it } from 'vitest';
import { nudgeLyricBoundary, validateLyricTimestamps } from '../../src/domain/lyricTimestampEdit';

const lines = [
  { id: 'a', startSeconds: 1, endSeconds: 3 },
  { id: 'b', startSeconds: 4, endSeconds: 6 },
];

describe('lyric timestamp editing', () => {
  it('moves only the requested boundary of the selected lyric line', () => {
    expect(nudgeLyricBoundary(lines, 'b', 'start', 1)).toEqual([
      { id: 'a', startSeconds: 1, endSeconds: 3 },
      { id: 'b', startSeconds: 5, endSeconds: 6 },
    ]);
    expect(nudgeLyricBoundary(lines, 'b', 'end', -1)).toEqual([
      { id: 'a', startSeconds: 1, endSeconds: 3 },
      { id: 'b', startSeconds: 4, endSeconds: 5 },
    ]);
  });

  it('rejects duplicate starts and overlapping lyric ranges before saving', () => {
    expect(validateLyricTimestamps([
      { id: 'a', startSeconds: 1, endSeconds: 3 },
      { id: 'b', startSeconds: 1, endSeconds: 4 },
    ])).toBe('Hai câu không được có timestamp bắt đầu trùng nhau.');
    expect(validateLyricTimestamps([
      { id: 'a', startSeconds: 1, endSeconds: 4 },
      { id: 'b', startSeconds: 3, endSeconds: 5 },
    ])).toBe('Các câu không được chồng lấp thời gian.');
    expect(validateLyricTimestamps([
      { id: 'a', startSeconds: 1, endSeconds: 100 },
      { id: 'b', startSeconds: 2, endSeconds: 3 },
      { id: 'c', startSeconds: 4, endSeconds: 5 },
    ])).toBe('Các câu không được chồng lấp thời gian.');
  });

  it('rejects a move that would make a timestamp negative', () => {
    expect(validateLyricTimestamps([{ id: 'a', startSeconds: -1, endSeconds: 1 }]))
      .toBe('Timestamp không được âm.');
  });
});
