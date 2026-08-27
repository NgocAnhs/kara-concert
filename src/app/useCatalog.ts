import { useCallback, useEffect, useRef, useState } from 'react';
import type { Song } from '../domain/song';
import type { PublicCatalogClient } from '../repositories/songRepository';
import { listPublishedSongs } from '../repositories/songRepository';

export function useCatalog(client: PublicCatalogClient | null) {
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const generation = useRef(0);

  const reload = useCallback(async (signal?: AbortSignal): Promise<Song[]> => {
    if (!client) return [];
    const current = ++generation.current;
    try {
      const result = await listPublishedSongs(client);
      if (!active.current || current !== generation.current || signal?.aborted) throw new DOMException('Catalog request was superseded', 'AbortError');
      setSongs(result);
      setError(null);
      return result;
    } catch (reason) {
      if (active.current && current === generation.current && !signal?.aborted) {
        setError(reason instanceof Error ? reason.message : 'Could not load published songs.');
      }
      throw reason;
    }
  }, [client]);

  useEffect(() => {
    active.current = true;
    if (client) void reload().catch(() => undefined);
    return () => { active.current = false; generation.current += 1; };
  }, [client, reload]);

  return { songs, error, reload };
}
