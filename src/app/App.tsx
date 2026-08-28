import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { Brand } from '../components/Brand';
import { PracticePanel } from '../components/PracticePanel';
import { SongLibrary } from '../components/SongLibrary';
import { ImportPage } from '../features/import/ImportPage';
import { ImportStatusPage } from '../features/import/ImportStatusPage';
import { getAccess, updateLyricTimestamps } from '../features/import/client';
import type { Song } from '../domain/song';
import { createSongRoutes } from '../domain/songRoutes';
import { supabase } from '../lib/supabase';
import { useCatalog } from './useCatalog';

export function App() {
  return <BrowserRouter><AppRoutes /></BrowserRouter>;
}

type CatalogState = { songs: Song[] | null; error: string | null };

function AppRoutes() {
  const { songs, error, reload } = useCatalog(supabase);
  const navigate = useNavigate();
  const onCompleted = useCallback(async (songId: string, signal?: AbortSignal) => {
    try {
      const catalog = await reload(signal);
      if (signal?.aborted) return false;
      const route = createSongRoutes(catalog).find((entry) => entry.song.id === songId);
      if (!route) return false;
      navigate(route.pathname);
      return true;
    } catch { return false; }
  }, [navigate, reload]);

  return (
    <Routes>
      <Route path="/" element={<LibraryPage songs={songs} error={error} />} />
      <Route path="/import" element={<ImportPage onJob={(jobId) => navigate(`/imports/${encodeURIComponent(jobId)}`)} onCompleted={onCompleted} />} />
      <Route path="/imports/:jobId" element={<ImportStatusRoute onCompleted={onCompleted} />} />
      <Route path="/practice/:songKey" element={<PracticePage songs={songs} error={error} reload={reload} />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

function ImportStatusRoute({ onCompleted }: { onCompleted(songId: string, signal?: AbortSignal): Promise<boolean> }) {
  const { jobId } = useParams();
  if (!jobId) return <NotFoundPage />;
  return <ImportStatusPage jobId={jobId} onCompleted={onCompleted} />;
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

function PracticePage({ songs, error, reload }: CatalogState & { reload(signal?: AbortSignal): Promise<Song[]> }) {
  const { songKey } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const routes = useMemo(() => createSongRoutes(songs ?? []), [songs]);
  const [canEdit, setCanEdit] = useState(false);
  useEffect(() => {
    let active = true;
    void getAccess().then((access) => { if (active) setCanEdit(access.unlocked); }).catch(() => { if (active) setCanEdit(false); });
    return () => { active = false; };
  }, []);
  if (!supabase || error || songs === null) {
    return <RouteMessage title="Luyện hát"><CatalogNotice songs={songs} error={error} /></RouteMessage>;
  }
  const route = routes.find((entry) => entry.song.id === songKey)
    ?? routes.find((entry) => entry.slug === songKey);
  if (!route) return <NotFoundPage songMissing />;
  if (songKey !== route.slug) {
    return <Navigate replace to={{ pathname: route.pathname, search: location.search, hash: location.hash }} />;
  }
  const { song } = route;
  return <PracticePanel key={song.id} song={song} onBack={() => navigate('/')} canEdit={canEdit} onUpdateTimestamps={async (lines) => {
    await updateLyricTimestamps(song.id, lines);
    await reload();
  }} />;
}

function LibraryPage({ songs, error }: CatalogState) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigate = useNavigate();
  const routes = useMemo(() => createSongRoutes(songs ?? []), [songs]);
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
      <p className="import-link"><Link to="/import">Thêm bài từ YouTube</Link></p>
      {supabase && songs && <SongLibrary songs={songs} onPractice={(song) => {
        const route = routes.find((entry) => entry.song.id === song.id);
        if (route) navigate(route.pathname);
      }} />}
      <footer className="site-footer"><span>Luyện một chút mỗi ngày. Tự tin hơn mỗi lần hát.</span><span>Made for your next concert.</span></footer>
    </main>
  );
}
