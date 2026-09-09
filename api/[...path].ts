import app from '../dist/vercel.mjs';
// Vercel transpiles this TypeScript dependency to JavaScript but leaves ESM
// specifiers intact. Node's ESM loader never adds a missing extension.
import { forwardVercelRequest } from '../apps/server/src/vercel-adapter.js';

export default function handler(request: Parameters<typeof forwardVercelRequest>[1], response: Parameters<typeof forwardVercelRequest>[2]) {
  return forwardVercelRequest(app.fetch.bind(app), request, response);
}
