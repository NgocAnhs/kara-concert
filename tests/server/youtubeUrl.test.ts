// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseYouTubeUrl } from '../../server/imports/youtube-url';

describe('parseYouTubeUrl', () => {
  it.each([
    ['https://youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ?si=tracking', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/embed/dQw4w9WgXcQ?t=10', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?feature=share', 'dQw4w9WgXcQ'],
  ])('canonicalizes supported public video links: %s', (input, videoId) => {
    expect(parseYouTubeUrl(input)).toEqual({ videoId, canonicalUrl: `https://www.youtube.com/watch?v=${videoId}` });
  });

  it.each([
    'http://youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com:444/watch?v=dQw4w9WgXcQ',
    'https://user@youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123',
    'https://youtube.com/watch?v=dQw4w9WgXcQ&v=dQw4w9WgXcQ',
    'https://youtube.com/playlist?list=PL123',
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ/playlist',
    'https://youtube.com/watch?v=short',
    'https://youtube.com/watch?%76=dQw4w9WgXcQ',
    'https://@youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/shorts/dQw4w9WgXcQ?v=dQw4w9WgXcQ&v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?v=dQw4w9WgXcQ&v=dQw4w9WgXcQ',
  ])('rejects ambiguous or unsafe input: %s', (input) => {
    expect(() => parseYouTubeUrl(input)).toThrow(/INVALID_YOUTUBE_URL/);
  });
});
