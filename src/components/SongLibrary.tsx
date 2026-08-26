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
  return (
    <section aria-label="Thư viện bài hát" className="library-shell">
      <div className="library-header">
        <div>
          <p className="eyebrow">Bài hát cho buổi luyện hôm nay</p>
          <h2>Setlist của bạn<span className="heading-dot" aria-hidden="true">.</span></h2>
        </div>
        <p className="library-count" aria-live="polite">{visibleSongs.length} bài hát</p>
      </div>
      <div className="search-control">
        <label className="search-label" htmlFor="song-search">Tìm bài hát</label>
        <div className="search-field">
        <span className="search-symbol" aria-hidden="true" />
        <input
          id="song-search"
          type="search"
          placeholder="Tìm bài hát bạn muốn luyện…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        </div>
      </div>
      {songs.length === 0 ? <div className="empty-state" role="status"><h3>Chưa có bài hát được xuất bản.</h3><p>Setlist đang được chuẩn bị. Bạn quay lại sau nhé.</p></div> : visibleSongs.length === 0 && <div className="empty-state" role="status"><h3>Không tìm thấy bài hát phù hợp.</h3><p>Thử một tên khác hoặc xóa nội dung tìm kiếm nhé.</p></div>}
      <ul className="song-grid">
        {visibleSongs.map((song, index) => (
          <li key={song.id} className={`song-card cover-variant-${index % 3}`}>
            <div className="song-cover" aria-hidden="true"><span>{song.title.slice(0, 2).toUpperCase()}</span><i /></div>
            <div className="song-card-body"><p className="song-card-kicker">Sẵn sàng lên giọng</p><h3>{song.title}</h3><p className="song-card-copy">{song.lines.length > 0 ? `${song.lines.length} câu hát để luyện` : 'Khám phá bài hát'}</p></div>
            <button className="song-play" type="button" aria-label={`Luyện hát ${song.title}`} onClick={() => onPractice(song)}>
              <span className="play-symbol" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <aside className="practice-tip"><span className="tip-label">MẸO NHỎ</span><p><strong>Chưa thuộc? Cứ chậm lại.</strong> Chọn một câu, giảm tốc độ và lặp đến khi giai điệu trở nên quen thuộc.</p><span className="tip-decoration" aria-hidden="true">0.75×</span></aside>
    </section>
  );
}
