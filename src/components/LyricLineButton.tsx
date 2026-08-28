import type { LyricLine } from '../domain/song';

type LyricLineButtonProps = {
  line: LyricLine;
  selected: boolean;
  active: boolean;
  editing?: boolean;
  onSelect(): void;
  onStartNudge?(seconds: number): void;
  onEndNudge?(seconds: number): void;
  buttonRef(element: HTMLButtonElement | null): void;
};

export function LyricLineButton({ line, selected, active, editing = false, onSelect, onStartNudge, onEndNudge, buttonRef }: LyricLineButtonProps) {
  const timestamp = `${formatTimestamp(line.startSeconds)} - ${formatTimestamp(line.endSeconds)}`;
  return <div className="lyric-card-wrap">
    <button
      type="button"
      className={`lyric-card${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}`}
      aria-pressed={selected}
      aria-current={active ? 'true' : undefined}
      onClick={onSelect}
      ref={buttonRef}
    >
      <span className="lyric-card-topline">
        <span className="lyric-position"><span>{String(line.displayOrder + 1).padStart(2, '0')}</span><span aria-hidden="true">·</span><span>{timestamp}</span></span>
        <span className="lyric-states">{selected && <span className="selected-label">Đã chọn</span>}{active && <span className="active-label"><i aria-hidden="true" />Đang phát</span>}</span>
      </span>
      {line.vietHan && <small className="lyric-viet-han"><span className="lyric-field-label">Cách đọc tiếng Việt</span>{line.vietHan}</small>}
      {line.romanization && <small className="lyric-romanization">{line.romanization}</small>}
      {line.meaning && <small className="lyric-meaning">{line.meaning}</small>}
    </button>
    {editing && <section className="lyric-timestamp-controls" aria-label={`Chỉnh timestamp câu ${String(line.displayOrder + 1).padStart(2, '0')}`}>
      <p>Chỉnh câu {String(line.displayOrder + 1).padStart(2, '0')}</p>
      <div className="timestamp-boundary"><strong>Start</strong><button type="button" className="timestamp-button" onClick={() => onStartNudge?.(-1)} aria-label={`Giảm start câu ${String(line.displayOrder + 1).padStart(2, '0')} bớt 1 giây`}>−1s</button><button type="button" className="timestamp-button" onClick={() => onStartNudge?.(1)} aria-label={`Tăng start câu ${String(line.displayOrder + 1).padStart(2, '0')} thêm 1 giây`}>+1s</button></div>
      <div className="timestamp-boundary"><strong>End</strong><button type="button" className="timestamp-button" onClick={() => onEndNudge?.(-1)} aria-label={`Giảm end câu ${String(line.displayOrder + 1).padStart(2, '0')} bớt 1 giây`}>−1s</button><button type="button" className="timestamp-button" onClick={() => onEndNudge?.(1)} aria-label={`Tăng end câu ${String(line.displayOrder + 1).padStart(2, '0')} thêm 1 giây`}>+1s</button></div>
    </section>}
  </div>;
}

function formatTimestamp(seconds: number): string {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}
