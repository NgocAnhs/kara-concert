import type { SupabaseClient } from '@supabase/supabase-js';
import type { EditableTimestamp } from '../../src/domain/lyricTimestampEdit.js';
import type { LyricUpdateResult } from './handler.js';

export function createLyricEditRepository(db: SupabaseClient) {
  return {
    async updateLyrics(songId: string, lines: EditableTimestamp[]): Promise<LyricUpdateResult> {
      const { data: song, error: songError } = await db.from('songs').select('id').eq('id', songId).maybeSingle();
      if (songError) return { updated: false, code: 'LYRIC_UPDATE_FAILED' };
      if (!song) return { updated: false, code: 'SONG_NOT_FOUND' };
      const { data, error } = await db.rpc('update_lyric_timestamps', {
        p_song_id: songId,
        p_lines: lines.map((line) => ({ id: line.id, start_seconds: line.startSeconds, end_seconds: line.endSeconds })),
      });
      if (error) return { updated: false, code: 'LYRIC_UPDATE_FAILED' };
      if (data !== true) return { updated: false, code: 'INVALID_LYRIC_TIMESTAMPS' };
      return { updated: true };
    },
  };
}
