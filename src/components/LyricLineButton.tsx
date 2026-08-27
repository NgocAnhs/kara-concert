import type { LyricLine } from '../domain/song';

type LyricLineButtonProps = {
  line: LyricLine;
  selected: boolean;
  active: boolean;
  onSelect(): void;
  buttonRef(element: HTMLButtonElement | null): void;
};

export function LyricLineButton({ line, selected, active, onSelect, buttonRef }: LyricLineButtonProps) {
  const timestamp = `${Math.floor(line.startSeconds / 60)}:${Math.floor(line.startSeconds % 60).toString().padStart(2, '0')}`;
  return (
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
      {line.vietHan && <small className="lyric-viet-han">{line.vietHan}</small>}
      {line.romanization && <small className="lyric-romanization">{line.romanization}</small>}
      {line.meaning && <small className="lyric-meaning">{line.meaning}</small>}
    </button>
  );
}
