import type { Song } from './song';

type SongRoute = { song: Song; slug: string; pathname: string };

function titleSlug(title: string): string {
  return title.normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
}

export function createSongRoutes(songs: Song[]): SongRoute[] {
  const entries = songs.map((song) => ({ song, base: titleSlug(song.title) }));
  const counts = new Map<string, number>();
  for (const { base } of entries) counts.set(base, (counts.get(base) ?? 0) + 1);

  // Reserve every legacy ID so a title cannot hijack an existing shared link.
  const reserved = new Set(songs.map((song) => song.id));
  return entries.sort((a, b) => a.song.id < b.song.id ? -1 : a.song.id > b.song.id ? 1 : 0)
    .map(({ song, base }) => {
      // A normalized title never contains "--", keeping ID suffixes unambiguous.
      let slug = base && counts.get(base) === 1 && !reserved.has(base)
        ? base
        : `${base || 'song'}--${song.id}`;
      while (reserved.has(slug)) slug += `--${song.id}`;
      reserved.add(slug);
      return { song, slug, pathname: `/practice/${encodeURIComponent(slug)}` };
    });
}
