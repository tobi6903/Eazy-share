// The long-lived /api/events response. An open stream means "this device is online".
import type { EazyShareApp } from '../core/app.js';
import { assertValidSecret } from '../core/devices.js';
import { formatSse, type Subscriber } from '../core/events.js';
import type { RequestContext } from './context.js';

export function serveEventStream(ctx: RequestContext, app: EazyShareApp): void {
  const secret = ctx.query.get('id') ?? '';
  assertValidSecret(secret); // throws before any headers are sent

  const { res } = ctx;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 2000\n\n');

  const subscriber: Subscriber = {
    push: (event, data) => {
      if (!res.writableEnded) res.write(formatSse(event, data));
    },
  };
  const device = app.devices.connect(secret, ctx.query.get('name') ?? '', subscriber);

  const keepalive = setInterval(() => res.write(': ping\n\n'), app.settings.keepaliveMs);
  res.on('close', () => {
    clearInterval(keepalive);
    app.devices.disconnect(device, subscriber);
  });
}
