import { handle } from '@hono/node-server/vercel';
import app from '../dist/vercel.mjs';

// Hono reads the raw Node request body. Vercel's default parser consumes POST bodies
// first, which otherwise leaves /api/v1/session and sync mutations waiting forever.
export const config = { api: { bodyParser: false } };

export default handle(app);
