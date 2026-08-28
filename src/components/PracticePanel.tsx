import { useEffect, useRef, useState } from 'react';
import type { Song } from '../domain/song';
import { createPracticeRange, type PracticeRange } from '../domain/practiceRange';
import { Brand } from './Brand';
import { LyricLineButton } from './LyricLineButton';
import { YouTubePracticePlayer } from './YouTubePracticePlayer';
import { duplicateStartGroups, nudgeLyricBoundary, validateLyricTimestamps, type EditableTimestamp } from '../domain/lyricTimestampEdit';

type PracticePanelProps = {
  song: Song;
  onBack(): void;
  canEdit?: boolean;
  onUpdateTimestamps?(lines: EditableTimestamp[]): Promise<void>;
};

function formatSeconds(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

function formatEditorTimestamp(seconds: number): string {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

function timestampSaveError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  if (code === 'ACCESS_REQUIRED') return 'Phiên chỉnh sửa đã hết hạn. Hãy mở lại quyền bằng token import rồi thử lại.';
  if (code === 'INVALID_LYRIC_TIMESTAMPS') return 'Timestamp không hợp lệ. Hãy kiểm tra các câu được báo lỗi.';
  if (code === 'BODY_TOO_LARGE') return 'Bài hát có quá nhiều câu để lưu trong một lần. Hãy thử lại sau.';
  return 'Không thể lưu chỉnh sửa. Hãy kiểm tra quyền truy cập và thử lại.';
}

export function PracticePanel({ song, onBack, canEdit = false, onUpdateTimestamps }: PracticePanelProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [range, setRange] = useState<PracticeRange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [looping, setLooping] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [lines, setLines] = useState(song.lines);
  const [savedLines, setSavedLines] = useState(song.lines);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const lyricCardRefs = useRef(new Map<string, HTMLButtonElement>());
  const lyricListRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastActiveLineId = useRef<string | null>(null);
  const activeLineId = lines.find(
    (line) => currentTime >= line.startSeconds && currentTime < line.endSeconds,
  )?.id ?? null;

  useEffect(() => { headingRef.current?.focus(); }, []);

  useEffect(() => {
    setRange(createPracticeRange(lines, selectedIds));
  }, [lines, selectedIds]);

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
    const nextRange = createPracticeRange(lines, nextIds);
    if (nextIds.length > 0 && !nextRange) {
      setError('Hãy chọn các câu liền nhau để tạo một đoạn luyện hát.');
      return;
    }
    setError(null);
    setSelectedIds(nextIds);
    setRange(nextRange);
  };

  const timestampLines = lines.map(({ id, startSeconds, endSeconds, displayOrder }) => ({ id, startSeconds, endSeconds, displayOrder }));
  const timestampError = editing ? validateLyricTimestamps(timestampLines) : null;
  const duplicateStartError = editing ? duplicateStartGroups(timestampLines)
    .map((ids) => {
      const duplicateLines = ids.map((id) => lines.find((line) => line.id === id)!);
      const labels = duplicateLines.map((line) => String(line.displayOrder + 1).padStart(2, '0'));
      const seconds = duplicateLines[0]!.startSeconds;
      return `Câu ${labels.slice(0, -1).join(', câu ')} và câu ${labels.at(-1)} cùng start ${formatEditorTimestamp(seconds)}.`;
    }).join(' ') : null;
  const nudgeTimestamp = (lineId: string, boundary: 'start' | 'end', seconds: number) => {
    setEditError(null);
    const edited = nudgeLyricBoundary(timestampLines, lineId, boundary, seconds);
    setLines((current) => current.map((line) => edited.find((candidate) => candidate.id === line.id)
      ? { ...line, ...edited.find((candidate) => candidate.id === line.id)! } : line));
  };
  const saveTimestamps = async () => {
    if (!onUpdateTimestamps || timestampError || saving) return;
    setSaving(true); setEditError(null);
    try {
      await onUpdateTimestamps(timestampLines.map(({ id, startSeconds, endSeconds }) => ({ id, startSeconds, endSeconds })));
      setSavedLines(lines);
      setEditing(false);
    } catch (error) {
      setEditError(timestampSaveError(error));
    } finally { setSaving(false); }
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
            <p className="library-count" aria-live="polite">{selectedIds.length > 0 ? `${selectedIds.length} câu đã chọn` : `${lines.length} câu hát`}</p>
          </div>
          <div className="lyrics-actions">
            <p className="lyrics-help">{editing ? 'Chỉnh riêng Start hoặc End của từng câu, mỗi lần 1 giây.' : 'Chạm các câu liền nhau để luyện một đoạn.'}</p>
            {canEdit && onUpdateTimestamps && <button className="secondary-button edit-toggle" type="button" onClick={() => {
              if (editing) setLines(savedLines);
              setEditing((value) => !value);
              setEditError(null);
            }} aria-pressed={editing}>
              {editing ? 'Thoát chỉnh sửa' : 'Chỉnh sửa timestamp'}
            </button>}
          </div>
          {error && <p role="alert" className="notice notice-warning">{error}</p>}
          {(editError || duplicateStartError || timestampError) && <p role="alert" className="notice notice-warning">{editError ?? duplicateStartError ?? timestampError}</p>}
          {lines.length === 0 && <p role="status" className="notice">Bài hát này chưa có lời để luyện. Bạn vẫn có thể nghe video.</p>}
          <div className="lyric-list" role="group" aria-label="Các câu hát" ref={lyricListRef}>
            {lines.map((line) => (
              <LyricLineButton
                key={line.id}
                line={line}
                selected={selectedIds.includes(line.id)}
                active={line.id === activeLineId}
                editing={editing}
                onSelect={() => toggleLine(line.id)}
                onStartNudge={(seconds) => nudgeTimestamp(line.id, 'start', seconds)}
                onEndNudge={(seconds) => nudgeTimestamp(line.id, 'end', seconds)}
                buttonRef={(element) => {
                  if (element) lyricCardRefs.current.set(line.id, element);
                  else lyricCardRefs.current.delete(line.id);
                }}
              />
            ))}
          </div>
        </section>
      </div>
      {editing && <div className="timestamp-save-bar" role="region" aria-label="Lưu chỉnh sửa timestamp">
        <button className="primary-button" type="button" onClick={() => void saveTimestamps()} disabled={saving || Boolean(timestampError)}>
          {saving ? 'Đang cập nhật…' : 'Cập nhật chỉnh sửa'}
        </button>
      </div>}
    </main>
  );
}
