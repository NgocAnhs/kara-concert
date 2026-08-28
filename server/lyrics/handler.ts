import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import type { ServerConfig } from '../config.js';
import { assertOrigin, HttpError, readJsonBody, requireImportSession, sendError, sendJson } from '../http.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestampSchema = z.object({
  id: z.string().uuid(),
  startSeconds: z.number().finite().nonnegative(),
  endSeconds: z.number().finite().nonnegative(),
}).strict().refine((line) => line.endSeconds > line.startSeconds);
const updateSchema = z.object({ lines: z.array(timestampSchema).min(1).max(500) }).strict();

export type LyricEditDependencies = {
  config: ServerConfig | undefined;
  updateLyrics(songId: string, lines: z.infer<typeof timestampSchema>[]): Promise<boolean>;
  nowSeconds?: () => number;
};

function validTimestamps(lines: z.infer<typeof timestampSchema>[]): boolean {
  return new Set(lines.map((line) => line.id)).size === lines.length
    && new Set(lines.map((line) => line.startSeconds)).size === lines.length;
}

export function createLyricEditHandler(deps: LyricEditDependencies) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method !== 'PATCH') { res.setHeader('Allow', 'PATCH'); throw new HttpError(405, 'METHOD_NOT_ALLOWED'); }
      requireImportSession(req, deps.config, (deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))());
      const config = deps.config!;
      assertOrigin(req, config);
      const songId = req.query.id;
      if (typeof songId !== 'string' || !UUID.test(songId)) throw new HttpError(404, 'SONG_NOT_FOUND');
      const parsed = updateSchema.safeParse(await readJsonBody(req, 64 * 1024));
      if (!parsed.success || !validTimestamps(parsed.data.lines)) throw new HttpError(400, 'INVALID_LYRIC_TIMESTAMPS');
      if (!await deps.updateLyrics(songId, parsed.data.lines)) throw new HttpError(404, 'SONG_NOT_FOUND');
      sendJson(res, 200, { updated: true });
    } catch (error) {
      sendError(res, error, deps.config);
    }
  };
}
