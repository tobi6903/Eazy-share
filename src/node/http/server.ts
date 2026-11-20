// The HTTP server: dispatches each request to the router and turns errors into JSON.
import http from 'node:http';
import type { ErrorResponse } from '../../shared/api.js';
import type { EazyShareApp } from '../core/app.js';
import { NotFound, ServiceError } from '../core/errors.js';
import { buildRouter } from './api.js';
import { RequestContext } from './context.js';
import type { Router } from './router.js';

/** Errors that just mean "the other side hung up"; nothing to report. */
const CLIENT_GONE = new Set(['ECONNRESET', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE', 'ERR_STREAM_DESTROYED']);

const isClientGone = (error: unknown): boolean =>
  error instanceof Error && CLIENT_GONE.has((error as NodeJS.ErrnoException).code ?? '');

/** Build (but don't start) the server. */
export function createHttpServer(app: EazyShareApp): http.Server {
  const router = buildRouter(app);
  const server = http.createServer((req, res) => {
    void dispatch(router, app, req, res);
  });
  server.requestTimeout = 0; // big uploads can take longer than the 5-minute default
  return server;
}

async function dispatch(router: Router, app: EazyShareApp, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const ctx = new RequestContext(req, res, app.devices);
  try {
    const hit = router.resolve(req.method ?? 'GET', ctx.path);
    if (!hit) throw new NotFound('not found');
    ctx.params = hit.params;
    if (hit.route.auth) ctx.requireDevice();
    await hit.route.handler(ctx);
  } catch (error) {
    if (isClientGone(error)) return;
    req.resume(); // discard any unread body so the connection stays usable
    if (res.headersSent) {
      res.destroy(); // a streamed response failed half-way; nothing sensible left to send
      return;
    }
    if (error instanceof ServiceError) {
      const body: ErrorResponse = { error: error.message };
      ctx.sendJson(error.status, body);
    } else {
      console.error(error);
      ctx.sendJson(500, { error: 'internal error' } satisfies ErrorResponse);
    }
  }
}

/** Start listening. Pass port 0 to let the OS pick; resolves to the actual port. */
export function listen(server: http.Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    });
  });
}

export function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections(); // open event streams would otherwise keep it alive forever
  });
}
