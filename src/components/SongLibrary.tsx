import { useMemo, useState } from 'react';
import type { Song } from '../domain/song';

type SongLibraryProps = {
  songs: Song[];
  onPractice(song: Song): void;
};

export function SongLibrary({ songs, onPractice }: SongLibraryProps) {
  const [query, setQuery] = useState('');
  const visibleSongs = useMemo(
    () => songs.filter((song) => song.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
    [query, songs],
  );

  if (songs.length === 0) {
    return <p>No songs published yet.</p>;
  }

  return (
    <section aria-label="Song library">
      <label>
        Search songs
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <ul>
        {visibleSongs.map((song) => (
          <li key={song.id}>
            <h2>{song.title}</h2>
            <button type="button" onClick={() => onPractice(song)}>
              Practice {song.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
