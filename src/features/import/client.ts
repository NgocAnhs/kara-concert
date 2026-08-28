import type { ImportReply, PublicJob } from '../../../shared/import';
import type { EditableTimestamp } from '../../domain/lyricTimestampEdit';

type AccessState = { unlocked: boolean; expiresAt?: number };

export class ImportClientError extends Error {
  constructor(readonly status: number, readonly code?: string, readonly retryAfter?: number) {
    super(code ?? 'REQUEST_FAILED');
  }
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const retryAfter = response.headers.get('Retry-After');
  const body = response.status === 204 ? undefined : await response.json().catch(() => undefined) as { error?: string } | undefined;
  if (!response.ok) throw new ImportClientError(response.status, body?.error, retryAfter ? Number(retryAfter) : undefined);
  return body as T;
}

export function getAccess(signal?: AbortSignal): Promise<AccessState> {
  return requestJson('/api/access', { signal });
}

export function openAccess(token: string, signal?: AbortSignal): Promise<AccessState> {
  return requestJson('/api/access', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

export function closeAccess(signal?: AbortSignal): Promise<void> {
  return requestJson('/api/access', {
    method: 'DELETE', signal,
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

export function startImport(youtubeUrl: string, signal?: AbortSignal): Promise<ImportReply> {
  return requestJson('/api/imports', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ youtubeUrl }),
  });
}

export function getImport(jobId: string, signal?: AbortSignal): Promise<PublicJob> {
  return requestJson(`/api/imports/${encodeURIComponent(jobId)}`, { signal });
}

export function updateLyricTimestamps(songId: string, lines: EditableTimestamp[], signal?: AbortSignal): Promise<{ updated: true }> {
  return requestJson(`/api/songs/${encodeURIComponent(songId)}/lyrics`, {
    method: 'PATCH', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines }),
  });
}
