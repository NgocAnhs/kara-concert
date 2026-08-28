import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createRuntimeLyricEditHandler } from '../../../server/runtime.js';

export default async function lyrics(req: VercelRequest, res: VercelResponse): Promise<void> {
  await createRuntimeLyricEditHandler()(req, res);
}
