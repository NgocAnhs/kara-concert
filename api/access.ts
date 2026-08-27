import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createRuntimeAccessHandler } from '../server/runtime.js';

export default async function access(req: VercelRequest, res: VercelResponse): Promise<void> {
  await createRuntimeAccessHandler()(req, res);
}
