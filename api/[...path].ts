import { handle } from '@hono/node-server/vercel';
import app from '../dist/vercel.mjs';

export default handle(app);
