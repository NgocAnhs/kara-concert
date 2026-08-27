import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createRuntimeImportHandler } from '../../server/runtime.js';

export default async function imports(req: VercelRequest, res: VercelResponse): Promise<void> {
  await createRuntimeImportHandler()(req, res);
}
