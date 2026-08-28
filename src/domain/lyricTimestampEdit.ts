export type EditableTimestamp = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  displayOrder?: number;
};

type OrderedTimestamp = EditableTimestamp & { position: number };

function orderedLines(lines: EditableTimestamp[]): OrderedTimestamp[] {
  return lines
    .map((line, index) => ({ ...line, position: line.displayOrder ?? index }))
    .sort((first, second) => first.position - second.position);
}

function lineLabel(line: OrderedTimestamp): string {
  return String(line.position + 1).padStart(2, '0');
}

export function nudgeLyricBoundary(
  lines: EditableTimestamp[], lineId: string, boundary: 'start' | 'end', seconds: number,
): EditableTimestamp[] {
  return lines.map((line) => line.id === lineId
    ? { ...line, [boundary === 'start' ? 'startSeconds' : 'endSeconds']: (boundary === 'start' ? line.startSeconds : line.endSeconds) + seconds }
    : line);
}

export function duplicateStartGroups(lines: EditableTimestamp[]): string[][] {
  const groups = new Map<number, string[]>();
  for (const line of lines) groups.set(line.startSeconds, [...(groups.get(line.startSeconds) ?? []), line.id]);
  return [...groups.values()].filter((ids) => ids.length > 1);
}

export function validateLyricTimestamps(lines: EditableTimestamp[]): string | null {
  if (lines.some((line) => !Number.isFinite(line.startSeconds) || !Number.isFinite(line.endSeconds) || line.startSeconds < 0)) return 'Timestamp không được âm.';
  if (lines.some((line) => line.endSeconds <= line.startSeconds)) return 'Điểm kết thúc phải sau điểm bắt đầu.';
  if (duplicateStartGroups(lines).length > 0) {
    return 'Hai câu không được có timestamp bắt đầu trùng nhau.';
  }

  const ordered = orderedLines(lines);
  for (let laterIndex = 1; laterIndex < ordered.length; laterIndex += 1) {
    const later = ordered[laterIndex]!;
    for (let earlierIndex = 0; earlierIndex < laterIndex; earlierIndex += 1) {
      const earlier = ordered[earlierIndex]!;
      if (laterIndex === earlierIndex + 1) {
        if (later.startSeconds < earlier.endSeconds - 1) {
          return `Câu ${lineLabel(later)} overlap quá 1 giây với câu ${lineLabel(earlier)}.`;
        }
      } else if (later.startSeconds < earlier.endSeconds && earlier.startSeconds < later.endSeconds) {
        return `Câu ${lineLabel(later)} không được overlap với câu ${lineLabel(earlier)} vì không liền kề.`;
      }
    }
  }
  return null;
}
