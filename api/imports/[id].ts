import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createRuntimeImportStatusHandler } from '../../server/runtime.js';

export default async function importStatus(req: VercelRequest, res: VercelResponse): Promise<void> {
  await createRuntimeImportStatusHandler()(req, res);
}
