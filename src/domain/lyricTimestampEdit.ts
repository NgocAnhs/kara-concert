export type EditableTimestamp = { id: string; startSeconds: number; endSeconds: number };

export function moveLyricTimestamp(lines: EditableTimestamp[], lineId: string, seconds: number): EditableTimestamp[] {
  return lines.map((line) => line.id === lineId
    ? { ...line, startSeconds: line.startSeconds + seconds, endSeconds: line.endSeconds + seconds }
    : line);
}

export function validateLyricTimestamps(lines: EditableTimestamp[]): string | null {
  if (lines.some((line) => !Number.isFinite(line.startSeconds) || !Number.isFinite(line.endSeconds) || line.startSeconds < 0)) return 'Timestamp không được âm.';
  if (lines.some((line) => line.endSeconds <= line.startSeconds)) return 'Điểm kết thúc phải sau điểm bắt đầu.';
  const sorted = [...lines].sort((left, right) => left.startSeconds - right.startSeconds);
  if (sorted.some((line, index) => index > 0 && line.startSeconds === sorted[index - 1]!.startSeconds)) {
    return 'Hai câu không được có timestamp bắt đầu trùng nhau.';
  }
  if (sorted.some((line, index) => index > 0 && line.startSeconds < sorted[index - 1]!.endSeconds)) {
    return 'Các câu không được chồng lấp thời gian.';
  }
  return null;
}
