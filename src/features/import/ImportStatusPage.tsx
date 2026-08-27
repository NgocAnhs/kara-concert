import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { PublicJob } from '../../../shared/import';
import { AccessForm } from './AccessForm';
import { closeAccess, getAccess, getImport, ImportClientError } from './client';
import { terminalJobMessage } from './messages';

type ImportStatusPageProps = { jobId: string; onCompleted(songId: string, signal?: AbortSignal): Promise<boolean> };
const terminal = new Set<PublicJob['status']>(['completed', 'failed', 'expired']);

function stageText(job: PublicJob): string {
  if (job.status === 'completed') return 'Bài hát đã được tạo. Đang cập nhật thư viện…';
  const terminalMessage = terminalJobMessage(job);
  if (terminalMessage) return terminalMessage;
  if (job.status === 'checking_video') return 'Đang kiểm tra video…';
  if (job.status === 'transcribing') return 'Đang tạo lời bài hát…';
  return 'Đang tạo cách đọc và nghĩa…';
}

export function ImportStatusPage({ jobId, onCompleted }: ImportStatusPageProps) {
  const [access, setAccess] = useState<'checking' | 'locked' | 'unlocked' | 'unavailable'>('checking');
  const [job, setJob] = useState<PublicJob | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [completedSongId, setCompletedSongId] = useState<string | null>(null);
  const [reloadingCatalog, setReloadingCatalog] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(true);
  const pollAbort = useRef<AbortController | null>(null);
  const completionAbort = useRef<AbortController | null>(null);
  const accessAbort = useRef<AbortController | null>(null);
  const pollGeneration = useRef(0);

  useEffect(() => {
    heading.current?.focus();
    mounted.current = true;
    const controller = new AbortController();
    accessAbort.current = controller;
    getAccess(controller.signal).then((result) => {
      if (mounted.current && !controller.signal.aborted) setAccess(result.unlocked ? 'unlocked' : 'locked');
    }).catch((reason) => {
      if (!mounted.current || controller.signal.aborted) return;
      if (reason instanceof ImportClientError && reason.status === 503) setAccess('unavailable');
      else if (!(reason instanceof DOMException && reason.name === 'AbortError')) setAccess('locked');
    });
    return () => {
      mounted.current = false;
      controller.abort();
      pollAbort.current?.abort();
      completionAbort.current?.abort();
    };
  }, []);

  async function reloadCompletedSong(songId: string) {
    completionAbort.current?.abort();
    const controller = new AbortController();
    completionAbort.current = controller;
    setReloadingCatalog(true);
    try {
      const found = await onCompleted(songId, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      if (!found) setMessage('Bài hát đã hoàn tất nhưng chưa xuất hiện trong thư viện. Hãy tải lại thư viện.');
    } catch {
      if (mounted.current && !controller.signal.aborted) setMessage('Không thể tải lại thư viện. Hãy thử lại.');
    } finally {
      if (mounted.current && completionAbort.current === controller) setReloadingCatalog(false);
    }
  }

  useEffect(() => {
    if (access !== 'unlocked') return;
    const controller = new AbortController();
    pollAbort.current = controller;
    const currentPoll = ++pollGeneration.current;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    const poll = async () => {
      try {
        const next = await getImport(jobId, controller.signal);
        if (!active || controller.signal.aborted || currentPoll !== pollGeneration.current) return;
        setJob((previous) => previous?.status === next.status && previous.stage === next.stage && previous.songId === next.songId && previous.errorCode === next.errorCode ? previous : next);
        if (next.status === 'completed') {
          if (!next.songId) {
            setMessage('Bài hát đã hoàn tất nhưng chưa thể mở từ thư viện. Hãy tải lại thư viện.');
          } else {
            setCompletedSongId(next.songId);
            await reloadCompletedSong(next.songId);
          }
          return;
        }
        if (!terminal.has(next.status)) timeout = setTimeout(poll, 2000);
      } catch (reason) {
        if (!active || controller.signal.aborted || currentPoll !== pollGeneration.current || (reason instanceof DOMException && reason.name === 'AbortError')) return;
        if (reason instanceof ImportClientError && reason.status === 401) setAccess('locked');
        else if (reason instanceof ImportClientError && reason.status === 404) setMessage('Tác vụ không tồn tại hoặc không còn khả dụng.');
        else setMessage('Không thể cập nhật trạng thái tác vụ. Hãy thử tải lại trang.');
      }
    };
    void poll();
    return () => { active = false; controller.abort(); if (pollAbort.current === controller) pollAbort.current = null; if (timeout) clearTimeout(timeout); };
  }, [access, jobId, onCompleted]);

  async function logout() {
    if (loggingOut) return;
    accessAbort.current?.abort();
    pollAbort.current?.abort();
    completionAbort.current?.abort();
    pollGeneration.current += 1;
    setAccess('locked');
    setJob(null);
    setCompletedSongId(null);
    setMessage(null);
    setLogoutError(null);
    setLoggingOut(true);
    try { await closeAccess(); }
    catch { if (mounted.current) setLogoutError('Không thể xác nhận việc đóng quyền với máy chủ. Quyền đã được khóa trên thiết bị này.'); }
    finally { if (mounted.current) setLoggingOut(false); }
  }

  return <main className="app-shell import-shell"><section className="import-card" aria-labelledby="import-status-heading">
    <p className="eyebrow">Theo dõi tác vụ</p><h1 id="import-status-heading" ref={heading} tabIndex={-1}>Đang thêm bài từ YouTube</h1>
    {access === 'checking' && <p className="notice loading-notice" role="status">Đang kiểm tra quyền thêm bài…</p>}
    {access === 'unavailable' && <p className="notice notice-warning" role="alert">Chức năng thêm bài chưa sẵn sàng.</p>}
    {access === 'locked' && (loggingOut
      ? <p className="notice loading-notice" role="status">Đang đóng quyền thêm bài…</p>
      : <><p className="notice notice-warning" role="alert">Phiên mở quyền đã hết hạn. Hãy nhập lại mã để tiếp tục theo dõi tác vụ này.</p><AccessForm onUnlocked={() => { setLogoutError(null); setAccess('unlocked'); }} /></>)}
    {access === 'unlocked' && <><p className="notice" role="status">{job ? stageText(job) : 'Đang lấy trạng thái tác vụ…'}</p><div className="action-row">{job && (job.status === 'failed' || job.status === 'expired') && <Link className="secondary-button" to="/import">Thêm liên kết khác</Link>}<button className="ghost-button" type="button" onClick={logout}>Đóng quyền thêm bài</button></div></>}
    {message && <p className="notice notice-warning" role="alert">{message}</p>}
    {completedSongId && <button className="secondary-button" type="button" disabled={reloadingCatalog || loggingOut} onClick={() => void reloadCompletedSong(completedSongId)}>{reloadingCatalog ? 'Đang tải lại thư viện…' : 'Tải lại thư viện'}</button>}
    {logoutError && <p className="notice notice-warning" role="alert">{logoutError}</p>}
  </section></main>;
}
