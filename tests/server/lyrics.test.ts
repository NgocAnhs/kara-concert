// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assembleReading, splitLyric } from '../../server/imports/lyrics';

describe('lyric segmentation and assembly', () => {
  it('preserves English casing, spaces and curly apostrophes', () => {
    const segments = splitLyric('난 I’m coming HOME!');
    const korean = segments.find((segment) => segment.kind === 'hangul')!;
    expect(assembleReading(segments, { [korean.id]: 'Nan' })).toBe('Nan I’m coming HOME!');
    expect(assembleReading(splitLyric("I'm coming home"), {})).toBe("I'm coming home");
  });

  it('treats Hangul syllables and Jamo as replacement segments while retaining every literal byte', () => {
    const segments = splitLyric('난—난\nGO!');
    expect(assembleReading(segments, { 0: 'nan', 2: 'nan' })).toBe('nan—nan\nGO!');
  });

  it('rejects incomplete, duplicate and unexpected replacement IDs', () => {
    const segments = splitLyric('난 너');
    expect(() => assembleReading(segments, { 0: 'nan' })).toThrow(/INVALID_REPLACEMENTS/);
    expect(() => assembleReading(segments, { 0: 'nan', 1: 'neo', 9: 'extra' })).toThrow(/INVALID_REPLACEMENTS/);
  });

  it.each(['Привет', '你好', 'مرحبا'])('rejects unsupported alphabetic literal text: %s', (text) => {
    expect(() => splitLyric(`난 ${text}`)).toThrow(/INVALID_LYRIC/);
  });

  it('accepts Latin English, digits, punctuation and whitespace as literal text', () => {
    expect(splitLyric('난 I’m coming HOME! #2\n')).toEqual([
      { id: 0, kind: 'hangul', text: '난' },
      { id: 1, kind: 'literal', text: ' I’m coming HOME! #2\n' },
    ]);
  });
});
