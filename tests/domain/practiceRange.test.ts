import { describe, expect, it } from 'vitest';
import { createPracticeRange, shouldLoop } from '../../src/domain/practiceRange';
import type { LyricLine } from '../../src/domain/song';

const lines: LyricLine[] = [
  { id: 'a', korean: '첫 줄', displayOrder: 0, startSeconds: 1, endSeconds: 2 },
  { id: 'b', korean: '둘째 줄', displayOrder: 1, startSeconds: 2, endSeconds: 3 },
  { id: 'c', korean: '셋째 줄', displayOrder: 2, startSeconds: 3, endSeconds: 4 },
];

describe('practice ranges', () => {
  it('uses first start and final end for adjacent selected lines', () => {
    expect(createPracticeRange(lines, ['a', 'b'])).toEqual({
      startSeconds: 1,
      endSeconds: 3,
      lineIds: ['a', 'b'],
    });
  });

  it('rejects non-adjacent selected lines', () => {
    expect(createPracticeRange(lines, ['a', 'c'])).toBeNull();
  });

  it('loops at the range end', () => {
    expect(shouldLoop(3, { startSeconds: 1, endSeconds: 3, lineIds: ['a', 'b'] })).toBe(true);
  });
});
