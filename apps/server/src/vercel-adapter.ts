import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

export type VercelRequest = IncomingMessage & { body?: unknown };

function requestHeaders(request: IncomingMessage) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

function requestBody(request: VercelRequest): BodyInit {
  if (request.body !== undefined) {
    if (typeof request.body === 'string') return request.body;
    if (request.body instanceof Uint8Array) return request.body.buffer.slice(request.body.byteOffset, request.body.byteOffset + request.body.byteLength) as ArrayBuffer;
    return JSON.stringify(request.body);
  }
  return Readable.toWeb(request) as ReadableStream<Uint8Array>;
}

/**
 * Vercel may pre-parse a request body before a Serverless Function starts. The
 * generic Node adapter would then wait on an already-consumed stream. Forward
 * the parsed body when available, otherwise preserve the original stream.
 */
export async function forwardVercelRequest(
  fetchApp: (request: Request) => Response | Promise<Response>,
  request: VercelRequest,
  response: ServerResponse,
) {
  const method = request.method ?? 'GET';
  const headers = requestHeaders(request);
  const protocol = (headers.get('x-forwarded-proto') ?? 'https').split(',')[0].trim();
  const host = headers.get('host') ?? 'localhost';
  const init: RequestInit & { duplex?: 'half' } = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = requestBody(request);
    init.duplex = 'half';
  }
  const honoResponse = await fetchApp(new Request(`${protocol}://${host}${request.url ?? '/'}`, init));
  response.statusCode = honoResponse.status;
  honoResponse.headers.forEach((value, name) => response.setHeader(name, value));
  response.end(Buffer.from(await honoResponse.arrayBuffer()));
}
