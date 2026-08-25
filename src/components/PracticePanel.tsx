import { useState } from 'react';
import type { Song } from '../domain/song';
import { createPracticeRange, type PracticeRange } from '../domain/practiceRange';
import { YouTubePracticePlayer } from './YouTubePracticePlayer';

type PracticePanelProps = { song: Song; onBack(): void };

function formatSeconds(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

export function PracticePanel({ song, onBack }: PracticePanelProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [range, setRange] = useState<PracticeRange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [looping, setLooping] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  const toggleLine = (lineId: string) => {
    const nextIds = selectedIds.includes(lineId) ? selectedIds.filter((id) => id !== lineId) : [...selectedIds, lineId];
    const nextRange = createPracticeRange(song.lines, nextIds);
    if (nextIds.length > 0 && !nextRange) {
      setError('Choose adjacent lyric lines to make a practice range.');
      return;
    }
    setError(null);
    setSelectedIds(nextIds);
    setRange(nextRange);
  };

  return (
    <main>
      <button type="button" onClick={onBack}>Back to library</button>
      <h1>{song.title}</h1>
      <YouTubePracticePlayer
        youtubeUrl={song.youtubeUrl}
        range={range}
        looping={looping}
        playbackRate={playbackRate}
        onCurrentTime={setCurrentTime}
      />
      <p>{range ? `Selected: ${formatSeconds(range.startSeconds)} – ${formatSeconds(range.endSeconds)}` : 'Select a lyric line to practice.'}</p>
      <fieldset>
        <legend>Playback speed</legend>
        {[0.75, 1, 1.25].map((speed) => (
          <label key={speed}>
            <input
              type="radio"
              name="playback-speed"
              value={speed}
              checked={playbackRate === speed}
              onChange={() => setPlaybackRate(speed)}
            />
            {speed.toFixed(2).replace(/\.00$/, '')}x
          </label>
        ))}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <div aria-label="Lyrics">
        {song.lines.map((line) => (
          <button
            key={line.id}
            type="button"
            aria-pressed={selectedIds.includes(line.id)}
            onClick={() => toggleLine(line.id)}
          >
            <span className={currentTime >= line.startSeconds && currentTime < line.endSeconds ? 'active-line' : undefined}>{line.korean}</span>
            {line.romanization && <small>{line.romanization}</small>}
            {line.meaning && <small>{line.meaning}</small>}
          </button>
        ))}
      </div>
      <button type="button" disabled={!range} onClick={() => setLooping(false)}>Play once</button>
      <button type="button" disabled={!range} onClick={() => setLooping(true)}>Loop selected range</button>
      {looping && <p>Looping selected range</p>}
    </main>
  );
}
