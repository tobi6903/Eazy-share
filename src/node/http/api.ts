// The API: one small function per endpoint, registered on a Router.
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type {
  CreateTransferResponse,
  HealthResponse,
  RenameResponse,
  SendResponse,
} from '../../shared/api.js';
import type { EazyShareApp } from '../core/app.js';
import { APP_NAME, VERSION } from '../core/config.js';
import { BadRequest, NotFound } from '../core/errors.js';
import type { RequestContext } from './context.js';
import { serveEventStream } from './eventStream.js';
import { Router, type Handler } from './router.js';
import { serveStatic } from './staticFiles.js';

const ID = '([\\w-]+)';

export function buildRouter(app: EazyShareApp): Router {
  const router = new Router();

  // No device needed.
  router.add('GET', '/api/health', (ctx) => {
    const body: HealthResponse = { app: APP_NAME, version: VERSION };
    ctx.sendJson(200, body);
  });
  router.add('GET', '/api/events', (ctx) => serveEventStream(ctx, app));
  router.add('GET', `/api/download/${ID}`, (ctx) => download(ctx, app)); // device id comes in the query

  // Device required (X-Device header).
  const authed = (method: string, pattern: string, handler: (ctx: RequestContext, app: EazyShareApp) => void | Promise<void>): void => {
    const wrapped: Handler = (ctx) => handler(ctx, app);
    router.add(method, pattern, wrapped, true);
  };
  authed('POST', '/api/rename', rename);
  authed('POST', '/api/transfers', createTransfer);
  authed('POST', `/api/transfers/${ID}/files`, uploadFile);
  authed('POST', `/api/transfers/${ID}/send`, sendTransfer);
  authed('DELETE', `/api/transfers/${ID}`, abortTransfer);
  authed('GET', '/api/inbox', listInbox);
  authed('DELETE', `/api/inbox/${ID}`, dismiss);

  // Everything else is the web page. Must stay last: routes are matched in order.
  router.add('GET', '/.*', serveStatic);
  return router;
}

async function rename(ctx: RequestContext, app: EazyShareApp): Promise<void> {
  const body = await ctx.readJson();
  const name = app.devices.rename(ctx.deviceSecret, String(body['name'] ?? ''));
  const reply: RenameResponse = { name };
  ctx.sendJson(200, reply);
}

function createTransfer(ctx: RequestContext, app: EazyShareApp): void {
  const reply: CreateTransferResponse = { id: app.transfers.createStage(ctx.deviceSecret) };
  ctx.sendJson(201, reply);
}

async function uploadFile(ctx: RequestContext, app: EazyShareApp): Promise<void> {
  let relativePath: string;
  try {
    relativePath = decodeURIComponent(ctx.header('x-file-path') ?? '');
  } catch {
    throw new BadRequest('bad path');
  }
  const target = app.transfers.stageTarget(ctx.deviceSecret, ctx.param(0), relativePath);
  ctx.contentLength(); // must be declared (411 otherwise)
  try {
    await pipeline(ctx.req, fs.createWriteStream(target));
  } catch {
    fs.rmSync(target, { force: true }); // client went away mid-upload
    return;
  }
  ctx.sendJson(201, { ok: true });
}

async function sendTransfer(ctx: RequestContext, app: EazyShareApp): Promise<void> {
  const body = await ctx.readJson();
  const to = Array.isArray(body['to']) ? body['to'].map(String) : [];
  const transfer = await app.transfers.send(ctx.deviceSecret, ctx.param(0), to, String(body['name'] ?? ''));
  const reply: SendResponse = {
    id: transfer.id,
    name: transfer.name,
    size: transfer.size,
    sentTo: transfer.recipients.size,
  };
  ctx.sendJson(201, reply);
}

function abortTransfer(ctx: RequestContext, app: EazyShareApp): void {
  app.transfers.abortStage(ctx.deviceSecret, ctx.param(0));
  ctx.sendJson(200, { ok: true });
}

function listInbox(ctx: RequestContext, app: EazyShareApp): void {
  ctx.sendJson(200, app.transfers.inbox(ctx.deviceSecret));
}

function dismiss(ctx: RequestContext, app: EazyShareApp): void {
  app.transfers.dismiss(ctx.deviceSecret, ctx.param(0));
  ctx.sendJson(200, { ok: true });
}

async function download(ctx: RequestContext, app: EazyShareApp): Promise<void> {
  const transfer = app.transfers.transferForDownload(ctx.query.get('device') ?? '', ctx.param(0));
  let size: number;
  try {
    size = fs.statSync(transfer.zipPath).size;
  } catch {
    throw new NotFound('not found');
  }
  ctx.res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': size,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(transfer.name)}`,
  });
  await pipeline(fs.createReadStream(transfer.zipPath), ctx.res);
}
