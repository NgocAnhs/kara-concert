import { useEffect, useRef, useState } from 'react';
import { Brand } from '../components/Brand';
import { PracticePanel } from '../components/PracticePanel';
import { SongLibrary } from '../components/SongLibrary';
import type { Song } from '../domain/song';
import { supabase } from '../lib/supabase';
import { listPublishedSongs } from '../repositories/songRepository';

export function App() {
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousSong = useRef<Song | null>(null);

  useEffect(() => {
    if (!selectedSong && previousSong.current) headingRef.current?.focus();
    previousSong.current = selectedSong;
  }, [selectedSong]);

  useEffect(() => {
    if (!supabase) return;
    listPublishedSongs(supabase).then(setSongs).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Could not load published songs.');
    });
  }, []);

  if (selectedSong) return <PracticePanel song={selectedSong} onBack={() => setSelectedSong(null)} />;

  return (
    <main className="app-shell">
      <header className="site-header"><Brand /><span className="header-note">Phòng luyện hát của bạn</span></header>
      <section className="hero">
        <div className="hero-content">
          <p className="eyebrow">Từ căn phòng nhỏ đến sân khấu lớn</p>
          <h1 ref={headingRef} tabIndex={-1}>Thuộc từng câu.<br />Cháy hết mình.</h1>
          <p className="hero-copy">Chọn bài bạn thích. Luyện từng đoạn.<br />Sẵn sàng cho đêm concert.</p>
          <div className="hero-tags"><span>Luyện lời</span><span>Chậm lại</span><span>Lặp đến khi thuộc</span></div>
        </div>
        <div className="hero-art" aria-hidden="true"><div className="hero-disc" /><div className="concert-ticket"><span>CONCERT PRACTICE</span><strong>YOUR<br />NEXT<br />ENCORE.</strong><div className="ticket-bottom">ADMIT ONE <span>★</span> EVERY DAY</div></div></div>
        <span className="hero-sticker" aria-hidden="true">SING IT YOUR WAY</span>
      </section>
      {!supabase && <p role="alert" className="notice notice-warning">Thư viện chưa được kết nối với Supabase. Hãy thêm cấu hình công khai VITE_SUPABASE để tải bài hát.</p>}
      {supabase && error && <p role="alert" className="notice notice-warning">Chưa tải được thư viện bài hát. Bạn kiểm tra kết nối rồi tải lại trang nhé.</p>}
      {supabase && songs === null && !error && <p role="status" className="notice loading-notice"><span className="loading-dot" aria-hidden="true" />Đang tải bài hát…</p>}
      {supabase && songs && <SongLibrary songs={songs} onPractice={setSelectedSong} />}
      <footer className="site-footer"><span>Luyện một chút mỗi ngày. Tự tin hơn mỗi lần hát.</span><span>Made for your next concert.</span></footer>
    </main>
  );
}
