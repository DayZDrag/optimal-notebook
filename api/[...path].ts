import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import app from '../dist/vercel.mjs';

type VercelRequest = IncomingMessage & { body?: unknown };

function requestHeaders(request: IncomingMessage) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

function requestBody(request: VercelRequest) {
  if (request.body !== undefined) {
    if (typeof request.body === 'string' || request.body instanceof Uint8Array) return request.body;
    return JSON.stringify(request.body);
  }
  return Readable.toWeb(request) as ReadableStream;
}

/**
 * Vercel may pre-parse a request body before this function starts. The generic Hono
 * Node adapter then waits forever for a stream that has already ended. This bridge
 * accepts Vercel's parsed body when present and otherwise forwards the raw stream.
 */
export default async function handler(request: VercelRequest, response: ServerResponse) {
  const method = request.method ?? 'GET';
  const headers = requestHeaders(request);
  const protocol = (headers.get('x-forwarded-proto') ?? 'https').split(',')[0].trim();
  const host = headers.get('host') ?? 'localhost';
  const init: RequestInit & { duplex?: 'half' } = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = requestBody(request);
    init.duplex = 'half';
  }
  const honoResponse = await app.fetch(new Request(`${protocol}://${host}${request.url ?? '/'}`, init));
  response.statusCode = honoResponse.status;
  honoResponse.headers.forEach((value, name) => response.setHeader(name, value));
  response.end(Buffer.from(await honoResponse.arrayBuffer()));
}
