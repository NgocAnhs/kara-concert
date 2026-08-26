import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams } from 'react-router';
import { Brand } from '../components/Brand';
import { PracticePanel } from '../components/PracticePanel';
import { SongLibrary } from '../components/SongLibrary';
import type { Song } from '../domain/song';
import { supabase } from '../lib/supabase';
import { listPublishedSongs } from '../repositories/songRepository';

export function App() {
  return <BrowserRouter><AppRoutes /></BrowserRouter>;
}

type CatalogState = { songs: Song[] | null; error: string | null };

function AppRoutes() {
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    listPublishedSongs(supabase).then((result) => {
      if (active) setSongs(result);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load published songs.');
    });
    return () => { active = false; };
  }, []);

  return (
    <Routes>
      <Route path="/" element={<LibraryPage songs={songs} error={error} />} />
      <Route path="/practice/:songId" element={<PracticePage songs={songs} error={error} />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

function CatalogNotice({ songs, error }: CatalogState) {
  if (!supabase) return <p role="alert" className="notice notice-warning">Thư viện chưa được kết nối với Supabase. Hãy thêm cấu hình công khai VITE_SUPABASE để tải bài hát.</p>;
  if (error) return <p role="alert" className="notice notice-warning">Chưa tải được thư viện bài hát. Bạn kiểm tra kết nối rồi tải lại trang nhé.</p>;
  if (songs === null) return <p role="status" className="notice loading-notice"><span className="loading-dot" aria-hidden="true" />Đang tải bài hát…</p>;
  return null;
}

function RouteMessage({ title, children }: { title: string; children: ReactNode }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, [title]);
  return (
    <main className="app-shell">
      <header className="site-header"><Brand /></header>
      <section className="empty-state">
        <h1 ref={headingRef} tabIndex={-1}>{title}</h1>
        {children}
        <Link className="ghost-button route-home-link" to="/">Về thư viện</Link>
      </section>
    </main>
  );
}

function NotFoundPage({ songMissing = false }: { songMissing?: boolean }) {
  return (
    <RouteMessage title={songMissing ? 'Không tìm thấy bài hát' : 'Không tìm thấy trang'}>
      <p>404 — {songMissing ? 'Bài hát không tồn tại hoặc chưa được xuất bản.' : 'Đường dẫn này không tồn tại.'}</p>
    </RouteMessage>
  );
}

function PracticePage({ songs, error }: CatalogState) {
  const { songId } = useParams();
  const navigate = useNavigate();
  if (!supabase || error || songs === null) {
    return <RouteMessage title="Luyện hát"><CatalogNotice songs={songs} error={error} /></RouteMessage>;
  }
  const song = songs.find((entry) => entry.id === songId);
  if (!song) return <NotFoundPage songMissing />;
  return <PracticePanel key={song.id} song={song} onBack={() => navigate('/')} />;
}

function LibraryPage({ songs, error }: CatalogState) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigate = useNavigate();
  useEffect(() => { headingRef.current?.focus(); }, []);

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
      <CatalogNotice songs={songs} error={error} />
      {supabase && songs && <SongLibrary songs={songs} onPractice={(song) => navigate(`/practice/${encodeURIComponent(song.id)}`)} />}
      <footer className="site-footer"><span>Luyện một chút mỗi ngày. Tự tin hơn mỗi lần hát.</span><span>Made for your next concert.</span></footer>
    </main>
  );
}
