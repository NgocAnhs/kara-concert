import { describe, expect, it } from 'vitest';
import { duplicateStartGroups, nudgeLyricBoundary, validateLyricTimestamps } from '../../src/domain/lyricTimestampEdit';

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

  it('reports every group of lyric lines with duplicate starts', () => {
    expect(duplicateStartGroups([
      { id: 'a', startSeconds: 1, endSeconds: 3 },
      { id: 'b', startSeconds: 1, endSeconds: 4 },
      { id: 'c', startSeconds: 4, endSeconds: 5 },
      { id: 'd', startSeconds: 4, endSeconds: 7 },
    ])).toEqual([['a', 'b'], ['c', 'd']]);
    expect(validateLyricTimestamps([
      { id: 'a', startSeconds: 1, endSeconds: 3 },
      { id: 'b', startSeconds: 1, endSeconds: 4 },
    ])).toBe('Hai câu không được có timestamp bắt đầu trùng nhau.');
  });

  it('allows at most one second of overlap between adjacent lyric lines', () => {
    expect(validateLyricTimestamps([
      { id: 'a', startSeconds: 1, endSeconds: 4, displayOrder: 0 },
      { id: 'b', startSeconds: 3, endSeconds: 5, displayOrder: 1 },
    ])).toBeNull();
    expect(validateLyricTimestamps([
      { id: 'a', startSeconds: 1, endSeconds: 4, displayOrder: 0 },
      { id: 'b', startSeconds: 2, endSeconds: 5, displayOrder: 1 },
    ])).toBe('Câu 02 overlap quá 1 giây với câu 01.');
  });

  it('rejects an overlap between lyric lines that are not adjacent', () => {
    expect(validateLyricTimestamps([
      { id: 'a', startSeconds: 1, endSeconds: 10, displayOrder: 0 },
      { id: 'b', startSeconds: 9, endSeconds: 10, displayOrder: 1 },
      { id: 'c', startSeconds: 9.5, endSeconds: 11, displayOrder: 2 },
    ])).toBe('Câu 03 không được overlap với câu 01 vì không liền kề.');
  });

  it('rejects a move that would make a timestamp negative', () => {
    expect(validateLyricTimestamps([{ id: 'a', startSeconds: -1, endSeconds: 1 }]))
      .toBe('Timestamp không được âm.');
  });
});
