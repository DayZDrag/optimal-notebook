import app from '../dist/vercel.mjs';
import { forwardVercelRequest } from '../apps/server/src/vercel-adapter';

export default function handler(request: Parameters<typeof forwardVercelRequest>[1], response: Parameters<typeof forwardVercelRequest>[2]) {
  return forwardVercelRequest(app.fetch.bind(app), request, response);
}
