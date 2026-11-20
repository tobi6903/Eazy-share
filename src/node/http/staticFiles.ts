// Serving the web page (<root>/dist/web: index.html, style.css and the compiled js/).
import fs from 'node:fs';
import path from 'node:path';
import { DIST_DIR } from '../core/config.js';
import { NotFound } from '../core/errors.js';
import { isWithin } from '../core/paths.js';
import type { RequestContext } from './context.js';

export const WEB_ROOT = path.join(DIST_DIR, 'web');

/** Only these file types are ever served. */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

export function serveStatic(ctx: RequestContext): void {
  let requested: string;
  try {
    requested = decodeURIComponent(ctx.path === '/' ? '/index.html' : ctx.path);
  } catch {
    throw new NotFound('not found');
  }
  const contentType = CONTENT_TYPES[path.extname(requested)];
  const file = path.join(WEB_ROOT, requested);
  const hidden = requested.split('/').some((part) => part.startsWith('.'));
  if (!contentType || hidden || !isWithin(WEB_ROOT, file)) throw new NotFound('not found');

  let data: Buffer;
  try {
    data = fs.readFileSync(file);
  } catch {
    throw new NotFound('not found');
  }
  ctx.sendBytes(200, data, contentType, { 'Cache-Control': 'no-cache' });
}
