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
  const selectedLineCount = selectedIds.length;

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
    <main className="practice-shell">
      <div className="practice-header">
        <button className="ghost-button" type="button" onClick={onBack}>Back to library</button>
        <div>
          <p className="eyebrow">Practice mode</p>
          <h1>{song.title}</h1>
        </div>
      </div>

      <div className="practice-layout">
        <section aria-label="Player" className="panel panel-player">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Playback</p>
              <h2>Player</h2>
            </div>
            <p className="selection-pill">
              {range
                ? `Selected: ${formatSeconds(range.startSeconds)} - ${formatSeconds(range.endSeconds)}`
                : 'Select a lyric line to start'}
            </p>
          </div>

          <div className="video-frame">
            <YouTubePracticePlayer
              youtubeUrl={song.youtubeUrl}
              range={range}
              looping={looping}
              playbackRate={playbackRate}
              onCurrentTime={setCurrentTime}
            />
          </div>

          <div className="control-cluster">
            <fieldset className="speed-control">
              <legend>Playback speed</legend>
              <div className="segmented-control">
                {[0.75, 1, 1.25].map((speed) => (
                  <label key={speed} className={playbackRate === speed ? 'segment is-active' : 'segment'}>
                    <input
                      type="radio"
                      name="playback-speed"
                      value={speed}
                      checked={playbackRate === speed}
                      onChange={() => setPlaybackRate(speed)}
                    />
                    <span>{speed.toFixed(2).replace(/\.00$/, '')}x</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="action-row">
              <button className={looping ? 'secondary-button' : 'primary-button'} type="button" disabled={!range} onClick={() => setLooping(false)}>Play once</button>
              <button className={looping ? 'primary-button' : 'secondary-button'} type="button" disabled={!range} onClick={() => setLooping(true)}>Loop selected range</button>
            </div>
          </div>

          {looping && <p className="notice">Looping selected range</p>}
          {error && <p role="alert" className="notice notice-warning">{error}</p>}
        </section>

        <section aria-label="Lyrics" className="panel panel-lyrics">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Line practice</p>
              <h2>Lyrics</h2>
            </div>
            <p className="library-count">
              {selectedLineCount > 0 ? `${selectedLineCount} line${selectedLineCount === 1 ? '' : 's'} selected` : 'Tap adjacent lines to build a loop'}
            </p>
          </div>

          <div className="lyric-list">
            {song.lines.map((line) => {
              const isSelected = selectedIds.includes(line.id);
              const isActive = currentTime >= line.startSeconds && currentTime < line.endSeconds;

              return (
                <button
                  key={line.id}
                  type="button"
                  className={isSelected ? 'lyric-card is-selected' : isActive ? 'lyric-card is-active' : 'lyric-card'}
                  aria-pressed={isSelected}
                  onClick={() => toggleLine(line.id)}
                >
                  <div className="lyric-card-topline">
                    <span className="lyric-time">{formatSeconds(line.startSeconds)}</span>
                    <span className="lyric-index">{String(line.displayOrder + 1).padStart(2, '0')}</span>
                  </div>
                  <span className={isActive ? 'active-line lyric-korean' : 'lyric-korean'}>{line.korean}</span>
                  {line.romanization && <small className="lyric-romanization">{line.romanization}</small>}
                  {line.meaning && <small className="lyric-meaning">{line.meaning}</small>}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
