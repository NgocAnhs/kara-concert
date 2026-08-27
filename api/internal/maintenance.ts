import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createRuntimeMaintenanceHandler } from '../../server/runtime.js';

export default async function maintenance(req: VercelRequest, res: VercelResponse): Promise<void> {
  await createRuntimeMaintenanceHandler()(req, res);
}
