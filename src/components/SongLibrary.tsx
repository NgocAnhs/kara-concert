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
  const songCountLabel = `${visibleSongs.length} song${visibleSongs.length === 1 ? '' : 's'} ready to practice`;

  if (songs.length === 0) {
    return <p className="notice">No songs published yet.</p>;
  }

  return (
    <section aria-label="Song library" className="library-shell">
      <div className="library-header">
        <div>
          <p className="eyebrow">Set list</p>
          <h2>Choose a song to rehearse</h2>
        </div>
        <p className="library-count">{songCountLabel}</p>
      </div>
      <label className="search-field">
        <span>Search songs</span>
        <input
          type="search"
          placeholder="Search by title"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <ul className="song-grid">
        {visibleSongs.map((song) => (
          <li key={song.id} className="song-card">
            <p className="song-card-kicker">Ready now</p>
            <h3>{song.title}</h3>
            <p className="song-card-copy">Open practice mode, tap lyric lines, and loop the tricky section until it lands.</p>
            <button className="primary-button" type="button" onClick={() => onPractice(song)}>
              Practice {song.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
