import type { VideoMetadata } from './types.js';

export type ProviderFailureCode = 'VIDEO_UNAVAILABLE' | 'PROVIDER_TRANSIENT' | 'PROVIDER_QUOTA' | 'PROVIDER_TIMEOUT';

export class ProviderFailure extends Error {
  constructor(readonly code: ProviderFailureCode) {
    super(code);
  }
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Options = { signal: AbortSignal };
type YouTubeProviderOptions = { apiKey: string; fetch?: Fetcher; now?: () => number };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const FIFTEEN_SECONDS = 15_000;

function unavailable(): never { throw new ProviderFailure('VIDEO_UNAVAILABLE'); }
function transient(): never { throw new ProviderFailure('PROVIDER_TRANSIENT'); }
function quota(): never { throw new ProviderFailure('PROVIDER_QUOTA'); }
function timeout(): never { throw new ProviderFailure('PROVIDER_TIMEOUT'); }

function parseDuration(value: unknown): number {
  if (typeof value !== 'string') transient();
  if (/^P\d+(?:\.\d+)?D(?:T.*)?$/.test(value)) unavailable();
  const matched = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  if (!matched || !matched.slice(1).some(Boolean)) transient();
  const seconds = Number(matched[1] ?? 0) * 3600 + Number(matched[2] ?? 0) * 60 + Number(matched[3] ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) transient();
  return seconds;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function composeSignal(signal: AbortSignal): { signal: AbortSignal; cancel: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let didTimeOut = false;
  const timeout = setTimeout(() => {
    didTimeOut = true;
    controller.abort();
  }, FIFTEEN_SECONDS);
  const abort = () => controller.abort();
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  return { signal: controller.signal, cancel: () => { clearTimeout(timeout); signal.removeEventListener('abort', abort); }, timedOut: () => didTimeOut };
}

export function createYouTubeProvider({ apiKey, fetch: fetcher = globalThis.fetch, now = Date.now }: YouTubeProviderOptions) {
  async function fetchVideo(videoId: string, { signal }: Options): Promise<VideoMetadata> {
    if (!VIDEO_ID.test(videoId) || !apiKey || typeof fetcher !== 'function') transient();
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,contentDetails,status');
    url.searchParams.set('id', videoId);
    const timed = composeSignal(signal);
    let body: unknown;
    try {
      const response = await fetcher(url, { method: 'GET', headers: { 'x-goog-api-key': apiKey }, signal: timed.signal });
      if (!response.ok) {
        if (response.status === 403 || response.status === 429) quota();
        transient();
      }
      body = await response.json();
    } catch (error) {
      if (error instanceof ProviderFailure) throw error;
      if (timed.timedOut()) timeout();
      transient();
    } finally {
      timed.cancel();
    }
    const root = asObject(body);
    if (!root || !Array.isArray(root.items)) transient();
    if (root.items.length === 0) unavailable();
    if (root.items.length !== 1) transient();
    const item = asObject(root.items[0]);
    const snippet = asObject(item?.snippet);
    const details = asObject(item?.contentDetails);
    const status = asObject(item?.status);
    if (!item || item.id !== videoId || !snippet || !details || !status || typeof snippet.title !== 'string') transient();
    if (status.privacyStatus !== 'public' || status.embeddable !== true || snippet.liveBroadcastContent !== 'none') unavailable();
    if (details.contentRating !== undefined) {
      const rating = asObject(details.contentRating);
      if (!rating || (rating.ytRating !== undefined && typeof rating.ytRating !== 'string')) transient();
      if (rating.ytRating === 'ytAgeRestricted') unavailable();
    }
    if (details.regionRestriction !== undefined) {
      const region = asObject(details.regionRestriction);
      if (!region) transient();
      if (region.allowed !== undefined && (!Array.isArray(region.allowed) || !region.allowed.every((country) => typeof country === 'string'))) transient();
      if (region.blocked !== undefined && (!Array.isArray(region.blocked) || !region.blocked.every((country) => typeof country === 'string'))) transient();
      if (region.allowed !== undefined || region.blocked !== undefined) unavailable();
    }
    const durationSeconds = parseDuration(details.duration);
    if (durationSeconds > 480) unavailable();
    const observedAt = now();
    const fetchedAt = new Date(observedAt).toISOString();
    const expiresAt = new Date(observedAt + 30 * 24 * 60 * 60 * 1000).toISOString();
    return { videoId, title: snippet.title, durationSeconds, isPublic: true, embeddable: true, isLive: false, playable: true, fetchedAt, expiresAt };
  }
  return { fetchVideo };
}
