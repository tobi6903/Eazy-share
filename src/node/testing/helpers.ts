// Shared test utilities: temp settings, a real server on a free port, and clients for it.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { EazyShareApp } from '../core/app.js';
import { createSettings, type Settings } from '../core/config.js';
import { close, createHttpServer, listen } from '../http/server.js';

export const SECRET_A = 'aaaaaaaaaaaaaaaaaaaa-A';
export const SECRET_B = 'bbbbbbbbbbbbbbbbbbbb-B';

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Settings pointing at a fresh temp folder; call `cleanup()` to delete it. */
export function makeTempSettings(overrides: Partial<Settings> = {}): { settings: Settings; cleanup(): void } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'eazy-test-'));
  return {
    settings: createSettings({ home, presenceGraceMs: 200, keepaliveMs: 60_000, ...overrides }),
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
  };
}

/** Same, but cleaned up automatically when the test ends. */
export function tempSettings(t: TestContext, overrides: Partial<Settings> = {}): Settings {
  const { settings, cleanup } = makeTempSettings(overrides);
  t.after(cleanup);
  return settings;
}

export interface RunningServer {
  app: EazyShareApp;
  port: number;
  settings: Settings;
}

/** A real server on 127.0.0.1 and a random port, stopped when the test ends. */
export async function startServer(t: TestContext): Promise<RunningServer> {
  const settings = tempSettings(t);
  const app = new EazyShareApp(settings);
  const server = createHttpServer(app);
  const port = await listen(server, '127.0.0.1', 0);
  t.after(() => close(server));
  return { app, port, settings };
}

export interface Reply {
  status: number;
  headers: Headers;
  body: Buffer;
  json(): unknown;
}

/** One device talking to the server. */
export class Client {
  constructor(
    readonly port: number,
    readonly secret: string,
  ) {}

  async request(
    method: string,
    pathAndQuery: string,
    options: { body?: Buffer | object; headers?: Record<string, string>; device?: boolean } = {},
  ): Promise<Reply> {
    const headers: Record<string, string> = { ...options.headers };
    if (options.device !== false) headers['X-Device'] = this.secret;
    let body: Buffer | undefined;
    if (Buffer.isBuffer(options.body)) {
      body = options.body;
    } else if (options.body) {
      body = Buffer.from(JSON.stringify(options.body));
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(`http://127.0.0.1:${this.port}${pathAndQuery}`, {
      method,
      headers,
      ...(body && { body: new Uint8Array(body) }),
    });
    const data = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      headers: response.headers,
      body: data,
      json: () => JSON.parse(data.toString('utf8')) as unknown,
    };
  }

  async upload(transferId: string, relativePath: string, content: Buffer | string): Promise<number> {
    const reply = await this.request('POST', `/api/transfers/${transferId}/files`, {
      body: Buffer.from(content),
      headers: { 'X-File-Path': encodeURIComponent(relativePath) },
    });
    return reply.status;
  }
}

export interface SseEvent {
  event: string;
  data: any;
}

/** A device's open /api/events connection, collecting events as they arrive. */
export class EventStream {
  readonly events: SseEvent[] = [];

  private constructor(
    private readonly request: http.ClientRequest,
    readonly status: number,
    response: http.IncomingMessage,
  ) {
    let buffer = '';
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => {
      buffer += chunk;
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (event && data) this.events.push({ event, data: JSON.parse(data) });
      }
    });
    response.on('error', () => undefined);
  }

  static open(t: TestContext, port: number, secret: string, name = ''): Promise<EventStream> {
    return new Promise((resolve, reject) => {
      const request = http.get(
        { host: '127.0.0.1', port, path: `/api/events?id=${secret}&name=${encodeURIComponent(name)}` },
        (response) => {
          const stream = new EventStream(request, response.statusCode ?? 0, response);
          t.after(() => stream.close());
          resolve(stream);
        },
      );
      request.on('error', reject);
    });
  }

  /** Resolves with the first event (from `from` onwards) matching the predicate. */
  async waitFor(predicate: (event: SseEvent) => boolean, from = 0, timeoutMs = 5000): Promise<SseEvent> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = this.events.slice(from).find(predicate);
      if (hit) return hit;
      await sleep(20);
    }
    throw new Error(`event not seen; got ${JSON.stringify(this.events)}`);
  }

  lastDevices(): { me: string; devices: { pid: string; name: string }[] } {
    const last = [...this.events].reverse().find((e) => e.event === 'devices');
    if (!last) throw new Error('no devices event yet');
    return last.data;
  }

  deviceNames(): string[] {
    return this.lastDevices().devices.map((d) => d.name).sort();
  }

  close(): void {
    this.request.destroy();
  }
}

/** Two devices (Alice and Bob) with open event streams, both seeing each other. */
export async function twoDevicesOnline(t: TestContext, port: number): Promise<{ alice: EventStream; bob: EventStream }> {
  const alice = await EventStream.open(t, port, SECRET_A, 'Alice');
  const bob = await EventStream.open(t, port, SECRET_B, 'Bob');
  await alice.waitFor((e) => e.event === 'devices' && e.data.devices.length === 2);
  await bob.waitFor((e) => e.event === 'devices' && e.data.devices.length === 2);
  return { alice, bob };
}
