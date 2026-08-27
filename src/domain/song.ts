import { z } from 'zod';

const lyricLineSchema = z
  .object({
    id: z.string().min(1),
    korean: z.string().refine((value) => value.trim().length > 0, 'A lyric line must not be blank'),
    viet_han: z.string().nullable().optional().transform((value) => value ?? undefined),
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
  source: z.enum(['manual', 'ai']).optional().default('manual'),
  ai_model: z.string().nullable().optional().transform((value) => value ?? undefined),
  prompt_version: z.string().nullable().optional().transform((value) => value ?? undefined),
  lyric_lines: z.array(lyricLineSchema),
});

export type LyricLine = {
  id: string;
  korean: string;
  vietHan?: string;
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
  source?: 'manual' | 'ai';
  aiModel?: string;
  promptVersion?: string;
  lines: LyricLine[];
};

export function parsePublishedSongs(value: unknown): Song[] {
  return z.array(songRowSchema).parse(value).map((song) => ({
    id: song.id,
    title: song.title,
    youtubeUrl: song.youtube_url,
    source: song.source,
    aiModel: song.ai_model,
    promptVersion: song.prompt_version,
    lines: song.lyric_lines
      .map((line) => ({
        id: line.id,
        korean: line.korean,
        vietHan: line.viet_han,
        romanization: line.romanization,
        meaning: line.meaning,
        displayOrder: line.display_order,
        startSeconds: line.start_seconds,
        endSeconds: line.end_seconds,
      }))
      .sort((left, right) => left.displayOrder - right.displayOrder),
  }));
}
