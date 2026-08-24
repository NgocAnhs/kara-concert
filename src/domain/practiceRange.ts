import type { LyricLine } from './song';

export type PracticeRange = {
  startSeconds: number;
  endSeconds: number;
  lineIds: string[];
};

export function createPracticeRange(lines: LyricLine[], selectedIds: string[]): PracticeRange | null {
  if (selectedIds.length === 0) {
    return null;
  }

  const selected = lines.filter((line) => selectedIds.includes(line.id));
  if (selected.length !== selectedIds.length) {
    return null;
  }

  const indexes = selected.map((line) => lines.findIndex((candidate) => candidate.id === line.id));
  if (indexes.some((index, position) => position > 0 && index !== indexes[position - 1] + 1)) {
    return null;
  }

  return {
    startSeconds: selected[0].startSeconds,
    endSeconds: selected[selected.length - 1].endSeconds,
    lineIds: selected.map((line) => line.id),
  };
}

export function shouldLoop(currentSeconds: number, range: PracticeRange): boolean {
  return currentSeconds >= range.endSeconds;
}
