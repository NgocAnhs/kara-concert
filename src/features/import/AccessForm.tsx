import { useState, type FormEvent } from 'react';
import { ImportClientError, openAccess } from './client';

type AccessFormProps = { onUnlocked(): void };

function accessError(error: unknown): string {
  if (error instanceof ImportClientError) {
    if (error.status === 401) return 'Mã truy cập không đúng.';
    if (error.status === 429) return error.retryAfter ? `Bạn có thể thử lại sau ${error.retryAfter} giây.` : 'Bạn đã thử quá nhiều lần. Hãy thử lại sau.';
    if (error.status === 503) return 'Chức năng thêm bài chưa sẵn sàng.';
  }
  return 'Không thể mở quyền thêm bài. Hãy kiểm tra kết nối và thử lại.';
}

export function AccessForm({ onUnlocked }: AccessFormProps) {
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const access = await openAccess(token);
      if (!access.unlocked) throw new ImportClientError(401, 'ACCESS_REQUIRED');
      onUnlocked();
    } catch (reason) {
      setError(accessError(reason));
    } finally {
      setToken('');
      setSubmitting(false);
    }
  }

  return <form className="import-form" onSubmit={submit}>
    <label htmlFor="import-token">Mã truy cập</label>
    <input id="import-token" name="token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} disabled={submitting} required />
    <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Đang mở quyền…' : 'Mở quyền thêm bài'}</button>
    {error && <p className="notice notice-warning" role="alert">{error}</p>}
  </form>;
}
