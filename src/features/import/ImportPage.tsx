import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AccessForm } from './AccessForm';
import { closeAccess, getAccess, ImportClientError, startImport } from './client';
import { admissionFailureMessage } from './messages';

type ImportPageProps = {
  onJob(jobId: string): void;
  onCompleted(songId: string, signal?: AbortSignal): Promise<boolean>;
};

export function ImportPage({ onJob, onCompleted }: ImportPageProps) {
  const [access, setAccess] = useState<'checking' | 'locked' | 'unlocked' | 'unavailable'>('checking');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedSongId, setCompletedSongId] = useState<string | null>(null);
  const [reloadingCatalog, setReloadingCatalog] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(true);
  const importAbort = useRef<AbortController | null>(null);
  const completionAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    heading.current?.focus();
    mounted.current = true;
    const controller = new AbortController();
    getAccess(controller.signal).then((result) => {
      if (mounted.current && !controller.signal.aborted) setAccess(result.unlocked ? 'unlocked' : 'locked');
    }).catch((reason) => {
      if (!mounted.current || controller.signal.aborted) return;
      if (reason instanceof ImportClientError && reason.status === 503) setAccess('unavailable');
      else if (reason instanceof DOMException && reason.name === 'AbortError') return;
      else setAccess('locked');
    });
    return () => {
      mounted.current = false;
      controller.abort();
      importAbort.current?.abort();
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
      if (!found) setError('Bài hát đã hoàn tất nhưng chưa xuất hiện trong thư viện. Hãy tải lại thư viện.');
    } catch {
      if (mounted.current && !controller.signal.aborted) setError('Không thể tải lại thư viện. Hãy thử lại.');
    } finally {
      if (mounted.current && completionAbort.current === controller) setReloadingCatalog(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    importAbort.current?.abort();
    const controller = new AbortController();
    importAbort.current = controller;
    try {
      const reply = await startImport(youtubeUrl, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      if ('songId' in reply) {
        setCompletedSongId(reply.songId);
        await reloadCompletedSong(reply.songId);
      } else onJob(reply.jobId);
    } catch (reason) {
      if (!mounted.current || controller.signal.aborted) return;
      if (reason instanceof ImportClientError && reason.status === 401) {
        setAccess('locked');
        setError('Phiên mở quyền đã hết hạn. Hãy nhập lại mã truy cập.');
      } else setError(admissionFailureMessage(reason));
    } finally {
      if (mounted.current && importAbort.current === controller) setSubmitting(false);
    }
  }

  async function logout() {
    if (loggingOut) return;
    importAbort.current?.abort();
    completionAbort.current?.abort();
    setAccess('locked');
    setYoutubeUrl('');
    setCompletedSongId(null);
    setError(null);
    setLogoutError(null);
    setLoggingOut(true);
    try { await closeAccess(); }
    catch { if (mounted.current) setLogoutError('Không thể xác nhận việc đóng quyền với máy chủ. Quyền đã được khóa trên thiết bị này.'); }
    finally { if (mounted.current) setLoggingOut(false); }
  }

  return <main className="app-shell import-shell">
    <section className="import-card" aria-labelledby="import-heading">
      <p className="eyebrow">Thêm bài mới</p>
      <h1 ref={heading} id="import-heading" tabIndex={-1}>Thêm bài từ YouTube</h1>
      {access === 'checking' && <p className="notice loading-notice" role="status">Đang kiểm tra quyền thêm bài…</p>}
      {access === 'unavailable' && <p className="notice notice-warning" role="alert">Chức năng thêm bài chưa sẵn sàng.</p>}
      {access === 'locked' && (loggingOut
        ? <p className="notice loading-notice" role="status">Đang đóng quyền thêm bài…</p>
        : <AccessForm onUnlocked={() => { setError(null); setLogoutError(null); setAccess('unlocked'); }} />)}
      {access === 'unlocked' && <>
        <form className="import-form" onSubmit={submit}>
          <label htmlFor="youtube-url">Liên kết YouTube</label>
          <input id="youtube-url" name="youtubeUrl" type="url" inputMode="url" placeholder="https://www.youtube.com/watch?v=…" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} disabled={submitting} required />
          <p className="import-help">Video phải công khai, cho phép nhúng và dài tối đa 8 phút. Bài hoàn tất sẽ được xuất bản công khai.</p>
          <p className="import-warning">AI tạo — lời và mốc thời gian có thể chưa chính xác.</p>
          <div className="action-row"><button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Đang tiếp nhận…' : 'Thêm bài'}</button><button className="ghost-button" type="button" onClick={logout}>Đóng quyền thêm bài</button></div>
        </form>
        {error && <p className="notice notice-warning" role="alert">{error}</p>}
      </>}
      {completedSongId && <button className="secondary-button" type="button" disabled={reloadingCatalog || loggingOut} onClick={() => void reloadCompletedSong(completedSongId)}>{reloadingCatalog ? 'Đang tải lại thư viện…' : 'Tải lại thư viện'}</button>}
      {logoutError && <p className="notice notice-warning" role="alert">{logoutError}</p>}
    </section>
  </main>;
}
