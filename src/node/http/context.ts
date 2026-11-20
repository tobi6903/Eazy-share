// One request, with the helpers handlers need. Wraps Node's request/response objects.
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import type { DeviceRegistry } from '../core/devices.js';
import { BadRequest, LengthRequired, NotFound } from '../core/errors.js';

const MAX_JSON_BYTES = 64 * 1024;

export class RequestContext {
  readonly path: string;
  readonly query: URLSearchParams;
  /** Capture groups from the matched route pattern. */
  params: string[] = [];
  /** Set by `requireDevice()` for authenticated routes. */
  deviceSecret = '';

  constructor(
    readonly req: IncomingMessage,
    readonly res: ServerResponse,
    private readonly devices: DeviceRegistry,
  ) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    this.path = url.pathname;
    this.query = url.searchParams;
  }

  // --- request ---------------------------------------------------------------

  header(name: string): string | undefined {
    const value = this.req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  param(index: number): string {
    const value = this.params[index];
    if (value === undefined) throw new NotFound('not found');
    return value;
  }

  requireDevice(): string {
    this.devices.require(this.header('x-device'));
    this.deviceSecret = this.header('x-device') as string;
    return this.deviceSecret;
  }

  /** The declared body size. Uploads must declare it (no chunked encoding). */
  contentLength(): number {
    const raw = this.header('content-length');
    if (raw === undefined || !/^\d+$/.test(raw)) throw new LengthRequired('Content-Length required');
    return Number(raw);
  }

  async readJson(): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of this.req) {
      size += (chunk as Buffer).length;
      if (size > MAX_JSON_BYTES) throw new BadRequest('request too large');
      chunks.push(chunk as Buffer);
    }
    try {
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
        return body as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
    throw new BadRequest('bad request');
  }

  // --- responses -------------------------------------------------------------

  sendJson(status: number, body: object): void {
    this.sendBytes(status, Buffer.from(JSON.stringify(body)), 'application/json; charset=utf-8', {
      'Cache-Control': 'no-store',
    });
  }

  sendBytes(status: number, data: Buffer, contentType: string, headers: OutgoingHttpHeaders = {}): void {
    this.res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': data.length, ...headers });
    this.res.end(data);
  }
}
