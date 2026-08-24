import { useEffect, useState } from 'react';
import { PracticePanel } from '../components/PracticePanel';
import { SongLibrary } from '../components/SongLibrary';
import type { Song } from '../domain/song';
import { supabase } from '../lib/supabase';
import { listPublishedSongs } from '../repositories/songRepository';

export function App() {
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);

  useEffect(() => {
    if (!supabase) return;
    listPublishedSongs(supabase).then(setSongs).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Could not load published songs.');
    });
  }, []);

  if (selectedSong) return <PracticePanel song={selectedSong} onBack={() => setSelectedSong(null)} />;

  return (
    <main>
      <h1>Concert Practice</h1>
      {!supabase && <p role="alert">Supabase is not configured. Add the public VITE_SUPABASE values to run the catalog.</p>}
      {supabase && error && <p role="alert">{error}</p>}
      {supabase && songs === null && !error && <p>Loading songs…</p>}
      {supabase && songs && <SongLibrary songs={songs} onPractice={setSelectedSong} />}
    </main>
  );
}
