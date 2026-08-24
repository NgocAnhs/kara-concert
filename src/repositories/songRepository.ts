import { parsePublishedSongs, type Song } from '../domain/song';

type QueryResult = { data: unknown; error: { message: string } | null };

export type PublicCatalogClient = {
  from(table: 'songs'): {
    select(columns: string): {
      order(column: string, options?: { foreignTable?: string }): {
        order(column: string, options?: { foreignTable?: string }): Promise<QueryResult>;
      };
    };
  };
};

export async function listPublishedSongs(client: PublicCatalogClient): Promise<Song[]> {
  const { data, error } = await client
    .from('songs')
    .select('id,title,youtube_url,lyric_lines(id,korean,romanization,meaning,display_order,start_seconds,end_seconds)')
    .order('title')
    .order('display_order', { foreignTable: 'lyric_lines' });

  if (error) {
    throw new Error(`Could not load published songs: ${error.message}`);
  }

  return parsePublishedSongs(data ?? []);
}
