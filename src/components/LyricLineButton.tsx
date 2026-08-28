import type { LyricLine } from '../domain/song';

type LyricLineButtonProps = {
  line: LyricLine;
  selected: boolean;
  active: boolean;
  editing?: boolean;
  onSelect(): void;
  onNudge?(seconds: number): void;
  buttonRef(element: HTMLButtonElement | null): void;
};

export function LyricLineButton({ line, selected, active, editing = false, onSelect, onNudge, buttonRef }: LyricLineButtonProps) {
  const timestamp = `${Math.floor(line.startSeconds / 60)}:${Math.floor(line.startSeconds % 60).toString().padStart(2, '0')}`;
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
    {editing && <div className="lyric-timestamp-controls" aria-label={`Chỉnh timestamp câu ${String(line.displayOrder + 1).padStart(2, '0')}`}>
      <button type="button" className="timestamp-button" onClick={() => onNudge?.(-1)} aria-label={`Giảm timestamp câu ${String(line.displayOrder + 1).padStart(2, '0')} bớt 1 giây`}>−1s</button>
      <button type="button" className="timestamp-button" onClick={() => onNudge?.(1)} aria-label={`Tăng timestamp câu ${String(line.displayOrder + 1).padStart(2, '0')} thêm 1 giây`}>+1s</button>
    </div>}
  </div>;
}
