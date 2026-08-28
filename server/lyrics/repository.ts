import type { SupabaseClient } from '@supabase/supabase-js';
import type { EditableTimestamp } from '../../src/domain/lyricTimestampEdit.js';

export function createLyricEditRepository(db: SupabaseClient) {
  return {
    async updateLyrics(songId: string, lines: EditableTimestamp[]): Promise<boolean> {
      const { data, error } = await db.rpc('update_lyric_timestamps', {
        p_song_id: songId,
        p_lines: lines.map((line) => ({ id: line.id, start_seconds: line.startSeconds, end_seconds: line.endSeconds })),
      });
      if (error || data !== true) return false;
      return true;
    },
  };
}
