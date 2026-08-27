import { useEffect, useRef, useState } from 'react';
import type { Song } from '../domain/song';
import { createPracticeRange, type PracticeRange } from '../domain/practiceRange';
import { Brand } from './Brand';
import { LyricLineButton } from './LyricLineButton';
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
  const lyricCardRefs = useRef(new Map<string, HTMLButtonElement>());
  const lyricListRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastActiveLineId = useRef<string | null>(null);
  const activeLineId = song.lines.find(
    (line) => currentTime >= line.startSeconds && currentTime < line.endSeconds,
  )?.id ?? null;

  useEffect(() => { headingRef.current?.focus(); }, []);

  useEffect(() => {
    if (!activeLineId || activeLineId === lastActiveLineId.current) return;
    lastActiveLineId.current = activeLineId;
    const card = lyricCardRefs.current.get(activeLineId);
    const list = lyricListRef.current;
    if (!card) return;
    const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const hasIndependentScroll = list && ['auto', 'scroll'].includes(window.getComputedStyle(list).overflowY);
    if (hasIndependentScroll) {
      // The positioned lyric list is the card's offset parent: scroll it, not the player.
      if (list.scrollHeight > list.clientHeight && list.clientHeight > 0) {
        list.scrollTo({ top: card.offsetTop - list.clientHeight / 2 + card.clientHeight / 2, behavior });
      }
    } else {
      card.scrollIntoView?.({ behavior, block: 'center', inline: 'nearest' });
    }
  }, [activeLineId]);

  const toggleLine = (lineId: string) => {
    const nextIds = selectedIds.includes(lineId) ? selectedIds.filter((id) => id !== lineId) : [...selectedIds, lineId];
    const nextRange = createPracticeRange(song.lines, nextIds);
    if (nextIds.length > 0 && !nextRange) {
      setError('Hãy chọn các câu liền nhau để tạo một đoạn luyện hát.');
      return;
    }
    setError(null);
    setSelectedIds(nextIds);
    setRange(nextRange);
  };

  return (
    <main className="practice-shell">
      <header className="practice-topbar">
        <button className="ghost-button back-button" type="button" onClick={onBack}><span aria-hidden="true">←</span> Về thư viện</button>
        <Brand />
      </header>
      <div className="practice-header">
        <div><p className="eyebrow">Sân khấu nhỏ của bạn</p><h1 ref={headingRef} tabIndex={-1}>{song.title}</h1></div>
        <span className="practice-badge">{song.source === 'ai' ? 'AI tạo' : 'Luyện từng câu'}</span>
      </div>
      {song.source === 'ai' && <p className="notice ai-notice">AI tạo — lời và mốc thời gian có thể chưa chính xác.</p>}

      <div className="practice-layout">
        <section aria-label="Trình phát" className="panel panel-player">
          <div className="panel-heading">
            <div><p className="panel-kicker">Nghe & cảm nhận</p><h2>Trình phát</h2></div>
            <span className="youtube-label">YouTube</span>
          </div>
          <div className="video-frame">
            <YouTubePracticePlayer youtubeUrl={song.youtubeUrl} range={range} looping={looping} playbackRate={playbackRate} onCurrentTime={setCurrentTime} />
          </div>
          <div className="control-cluster">
            <fieldset className="speed-control">
              <legend>Tốc độ phát</legend>
              <div className="segmented-control">
                {[0.75, 1, 1.25].map((speed) => (
                  <label key={speed} className={playbackRate === speed ? 'segment is-active' : 'segment'}>
                    <input type="radio" name="playback-speed" value={speed} checked={playbackRate === speed} onChange={() => setPlaybackRate(speed)} />
                    <span>{speed.toFixed(2).replace(/\.00$/, '')}x</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className={range ? 'selection-pill has-range' : 'selection-pill'} aria-live="polite">
              {range ? `Đã chọn: ${formatSeconds(range.startSeconds)} – ${formatSeconds(range.endSeconds)}` : 'Chọn một câu hát để luyện hoặc lặp đoạn.'}
            </p>
            <div className="action-row">
              <button className={looping ? 'secondary-button' : 'primary-button'} type="button" disabled={!range} aria-pressed={!looping} onClick={() => setLooping(false)}>Phát một lần</button>
              <button className={looping ? 'primary-button' : 'secondary-button'} type="button" disabled={!range} aria-pressed={looping} onClick={() => setLooping(true)}>Lặp đoạn</button>
            </div>
          </div>
          {looping && range && <p className="loop-status" role="status"><span aria-hidden="true" />Đang lặp đoạn đã chọn</p>}
          <p className="player-tip">Cứ chậm lại. Mỗi lần lặp là một lần tự tin hơn.</p>
        </section>

        <section aria-label="Lời bài hát" className="panel panel-lyrics">
          <div className="panel-heading">
            <div><p className="panel-kicker">Hát theo cách của bạn</p><h2>Lời bài hát</h2></div>
            <p className="library-count" aria-live="polite">{selectedIds.length > 0 ? `${selectedIds.length} câu đã chọn` : `${song.lines.length} câu hát`}</p>
          </div>
          <p className="lyrics-help">Chạm các câu liền nhau để luyện một đoạn.</p>
          {error && <p role="alert" className="notice notice-warning">{error}</p>}
          {song.lines.length === 0 && <p role="status" className="notice">Bài hát này chưa có lời để luyện. Bạn vẫn có thể nghe video.</p>}
          <div className="lyric-list" role="group" aria-label="Các câu hát" ref={lyricListRef}>
            {song.lines.map((line) => (
              <LyricLineButton
                key={line.id}
                line={line}
                selected={selectedIds.includes(line.id)}
                active={line.id === activeLineId}
                onSelect={() => toggleLine(line.id)}
                buttonRef={(element) => {
                  if (element) lyricCardRefs.current.set(line.id, element);
                  else lyricCardRefs.current.delete(line.id);
                }}
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
