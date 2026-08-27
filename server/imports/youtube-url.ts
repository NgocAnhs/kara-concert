const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

function invalid(): never {
  throw new Error('INVALID_YOUTUBE_URL');
}

function exactlyOne(values: string[]): string {
  if (values.length !== 1 || !VIDEO_ID.test(values[0] ?? '')) invalid();
  return values[0]!;
}

export function parseYouTubeUrl(input: string): { videoId: string; canonicalUrl: string } {
  if (typeof input !== 'string' || input.length === 0 || input.length > 4096) invalid();

  let url: URL;
  try { url = new URL(input); } catch { return invalid(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) invalid();
  const rawAuthority = /^https:\/\/([^/?#]*)/i.exec(input)?.[1];
  if (rawAuthority === undefined || rawAuthority.includes('@')) invalid();
  if (url.search.slice(1).split('&').some((parameter) => parameter.split('=', 1)[0]?.includes('%'))) invalid();
  if (url.searchParams.getAll('v').length > 1) invalid();

  let videoId: string;
  if (url.hostname === 'youtu.be') {
    if (url.searchParams.has('list') || url.pathname.split('/').filter(Boolean).length !== 1) invalid();
    videoId = exactlyOne(url.pathname.split('/').filter(Boolean));
  } else if (YOUTUBE_HOSTS.has(url.hostname)) {
    if (url.searchParams.has('list')) invalid();
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.pathname === '/watch' && parts.length === 1) {
      videoId = exactlyOne(url.searchParams.getAll('v'));
    } else if ((parts[0] === 'shorts' || parts[0] === 'embed') && parts.length === 2) {
      videoId = exactlyOne([parts[1]!]);
    } else {
      invalid();
    }
  } else {
    invalid();
  }

  return { videoId, canonicalUrl: `https://www.youtube.com/watch?v=${videoId}` };
}
