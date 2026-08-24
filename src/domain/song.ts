import { z } from 'zod';

const lyricLineSchema = z
  .object({
    id: z.string().min(1),
    korean: z.string().trim().min(1),
    romanization: z.string().nullable().optional().transform((value) => value ?? undefined),
    meaning: z.string().nullable().optional().transform((value) => value ?? undefined),
    display_order: z.number().int().nonnegative(),
    start_seconds: z.number().nonnegative(),
    end_seconds: z.number().nonnegative(),
  })
  .refine((line) => line.end_seconds > line.start_seconds, {
    message: 'A lyric line must end after it starts',
    path: ['end_seconds'],
  });

const songRowSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  youtube_url: z.string().url(),
  lyric_lines: z.array(lyricLineSchema),
});

export type LyricLine = {
  id: string;
  korean: string;
  romanization?: string;
  meaning?: string;
  displayOrder: number;
  startSeconds: number;
  endSeconds: number;
};

export type Song = {
  id: string;
  title: string;
  youtubeUrl: string;
  lines: LyricLine[];
};

export function parsePublishedSongs(value: unknown): Song[] {
  return z.array(songRowSchema).parse(value).map((song) => ({
    id: song.id,
    title: song.title,
    youtubeUrl: song.youtube_url,
    lines: song.lyric_lines
      .map((line) => ({
        id: line.id,
        korean: line.korean,
        romanization: line.romanization,
        meaning: line.meaning,
        displayOrder: line.display_order,
        startSeconds: line.start_seconds,
        endSeconds: line.end_seconds,
      }))
      .sort((left, right) => left.displayOrder - right.displayOrder),
  }));
}
