export type Segment = { id: number; kind: 'hangul' | 'literal'; text: string };

const HANGUL = /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]/u;

export function splitLyric(text: string): Segment[] {
  if (typeof text !== 'string') throw new Error('INVALID_LYRIC');
  const segments: Segment[] = [];
  let current = '';
  let currentKind: Segment['kind'] | undefined;
  for (const character of text) {
    const kind: Segment['kind'] = HANGUL.test(character) ? 'hangul' : 'literal';
    if (kind === 'literal' && /\p{L}/u.test(character) && !/\p{Script=Latin}/u.test(character)) throw new Error('INVALID_LYRIC');
    if (kind !== currentKind && current) {
      segments.push({ id: segments.length, kind: currentKind!, text: current });
      current = '';
    }
    currentKind = kind;
    current += character;
  }
  if (current) segments.push({ id: segments.length, kind: currentKind!, text: current });
  return segments;
}

export function assembleReading(segments: Segment[], replacements: Record<number, string>): string {
  const expected = new Set(segments.filter((segment) => segment.kind === 'hangul').map((segment) => segment.id));
  const supplied = Object.keys(replacements).map(Number);
  if (
    supplied.length !== expected.size
    || supplied.some((id) => !Number.isSafeInteger(id) || !expected.has(id) || typeof replacements[id] !== 'string')
  ) throw new Error('INVALID_REPLACEMENTS');

  return segments.map((segment) => segment.kind === 'hangul' ? replacements[segment.id]! : segment.text).join('');
}
