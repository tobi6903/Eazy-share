// End to end over real HTTP: two simulated devices talk to a real server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { unzipSync } from 'fflate';
import type { InboxItem, SendResponse } from '../../shared/api.js';
import {
  Client,
  EventStream,
  SECRET_A,
  SECRET_B,
  sleep,
  startServer,
  twoDevicesOnline,
} from '../testing/helpers.js';

/** Alice and Bob both online, plus clients for each. */
async function setup(t: TestContext) {
  const server = await startServer(t);
  const streams = await twoDevicesOnline(t, server.port);
  const bobPid = streams.alice.lastDevices().devices.find((d) => d.name === 'Bob')?.pid as string;
  return {
    ...server,
    ...streams,
    bobPid,
    alice: new Client(server.port, SECRET_A),
    bob: new Client(server.port, SECRET_B),
    aliceStream: streams.alice,
    bobStream: streams.bob,
  };
}

const BIG = Buffer.from(Uint8Array.from({ length: 512_000 }, (_, i) => i % 251));

async function sendTrip(ctx: Awaited<ReturnType<typeof setup>>): Promise<SendResponse> {
  const created = await ctx.alice.request('POST', '/api/transfers');
  assert.equal(created.status, 201);
  const { id } = created.json() as { id: string };
  assert.equal(await ctx.alice.upload(id, 'trip/day1/a.txt', 'beach'), 201);
  assert.equal(await ctx.alice.upload(id, 'trip/b.bin', BIG), 201);
  assert.equal(await ctx.alice.upload(id, 'trip/empty.txt', ''), 201);
  const sent = await ctx.alice.request('POST', `/api/transfers/${id}/send`, { body: { to: [ctx.bobPid], name: 'trip' } });
  assert.equal(sent.status, 201);
  return sent.json() as SendResponse;
}

describe('page and health', () => {
  it('serves the page and its assets', async (t) => {
    const { port } = await startServer(t);
    const client = new Client(port, SECRET_A);
    for (const [url, marker] of [
      ['/', 'Eazy-share'],
      ['/js/main.js', 'connectPresence'],
      ['/style.css', '--accent'],
    ] as const) {
      const reply = await client.request('GET', url, { device: false });
      assert.equal(reply.status, 200, url);
      assert.ok(reply.body.toString().includes(marker), url);
    }
  });

  it('reports health', async (t) => {
    const { port } = await startServer(t);
    const reply = await new Client(port, SECRET_A).request('GET', '/api/health', { device: false });
    assert.deepEqual(Object.keys(reply.json() as object).sort(), ['app', 'version']);
    assert.equal((reply.json() as { app: string }).app, 'eazy-share');
  });

  it('serves nothing outside the web folder', async (t) => {
    const { port } = await startServer(t);
    const client = new Client(port, SECRET_A);
    const probes = ['/nope', '/package.json', '/dist/core/config.js', '/%2e%2e/package.json', '/js/%2e%2e/%2e%2e/package.json', '/.env', '/api/nope'];
    for (const probe of probes) assert.equal((await client.request('GET', probe, { device: false })).status, 404, probe);
  });
});

describe('presence', () => {
  it('devices see each other, but never secrets', async (t) => {
    const { aliceStream, bobStream } = await setup(t);
    assert.deepEqual(aliceStream.deviceNames(), ['Alice', 'Bob']);
    assert.deepEqual(bobStream.deviceNames(), ['Alice', 'Bob']);
    const everything = JSON.stringify([aliceStream.events, bobStream.events]);
    assert.ok(!everything.includes(SECRET_A) && !everything.includes(SECRET_B));
  });

  it('closing a page takes the device offline', async (t) => {
    const { aliceStream, bobStream } = await setup(t);
    const seen = aliceStream.events.length;
    bobStream.close();
    await aliceStream.waitFor((e) => e.event === 'devices' && e.data.devices.length === 1, seen);
    assert.deepEqual(aliceStream.deviceNames(), ['Alice']);
  });

  it('broadcasts renames', async (t) => {
    const { aliceStream, bob } = await setup(t);
    const seen = aliceStream.events.length;
    assert.equal((await bob.request('POST', '/api/rename', { body: { name: 'Bobby' } })).status, 200);
    await aliceStream.waitFor((e) => e.event === 'devices' && e.data.devices.some((d: { name: string }) => d.name === 'Bobby'), seen);
  });

  it('rejects a malformed event-stream id', async (t) => {
    const { port } = await startServer(t);
    const stream = await EventStream.open(t, port, 'x');
    assert.equal(stream.status, 400);
  });
});

describe('authorisation', () => {
  it('needs a known device for device endpoints', async (t) => {
    const { port } = await setup(t);
    const stranger = new Client(port, 'zzzzzzzzzzzzzzzzzzzzzzzz');
    for (const [method, url] of [['GET', '/api/inbox'], ['POST', '/api/transfers'], ['POST', '/api/rename']] as const) {
      assert.equal((await stranger.request(method, url)).status, 401, url);
    }
    assert.equal((await new Client(port, SECRET_A).request('GET', '/api/inbox', { device: false })).status, 401);
  });
});

describe('the whole flow', () => {
  it('sends a folder, the recipient is told, and downloads an identical zip', async (t) => {
    const ctx = await setup(t);
    const seen = ctx.bobStream.events.length;
    const sent = await sendTrip(ctx);
    assert.deepEqual([sent.name, sent.sentTo], ['trip.zip', 1]);
    await ctx.bobStream.waitFor((e) => e.event === 'inbox', seen);

    const inbox = (await ctx.bob.request('GET', '/api/inbox')).json() as InboxItem[];
    assert.deepEqual(inbox.map((i) => i.name), ['trip.zip']);
    assert.equal(inbox[0]?.from, 'Alice');
    assert.deepEqual((await ctx.alice.request('GET', '/api/inbox')).json(), []);

    const download = await ctx.bob.request('GET', `/api/download/${inbox[0]?.id}?device=${SECRET_B}`, { device: false });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/zip');
    assert.match(download.headers.get('content-disposition') ?? '', /trip\.zip/);
    const entries = unzipSync(new Uint8Array(download.body));
    assert.deepEqual(Object.keys(entries).sort(), ['trip/b.bin', 'trip/day1/a.txt', 'trip/empty.txt']);
    assert.ok(Buffer.from(entries['trip/b.bin'] as Uint8Array).equals(BIG));
    assert.equal(Buffer.from(entries['trip/day1/a.txt'] as Uint8Array).toString(), 'beach');
  });

  it('only the recipient can download', async (t) => {
    const ctx = await setup(t);
    const sent = await sendTrip(ctx);
    for (const secret of [SECRET_A, 'unknown-device-secret-123', '']) {
      const reply = await ctx.alice.request('GET', `/api/download/${sent.id}?device=${secret}`, { device: false });
      assert.equal(reply.status, 404, secret);
    }
  });

  it('dismissing deletes the zip', async (t) => {
    const ctx = await setup(t);
    const sent = await sendTrip(ctx);
    const zip = path.join(ctx.settings.home, 'zips', `${sent.id}.zip`);
    assert.ok(fs.existsSync(zip));
    assert.equal((await ctx.bob.request('DELETE', `/api/inbox/${sent.id}`)).status, 200);
    assert.deepEqual((await ctx.bob.request('GET', '/api/inbox')).json(), []);
    assert.ok(!fs.existsSync(zip));
  });

  it('refuses to send to unknown devices or nobody', async (t) => {
    const ctx = await setup(t);
    const { id } = (await ctx.alice.request('POST', '/api/transfers')).json() as { id: string };
    await ctx.alice.upload(id, 'a.txt', 'x');
    const unknown = await ctx.alice.request('POST', `/api/transfers/${id}/send`, { body: { to: ['deadbeef'], name: 'a' } });
    const nobody = await ctx.alice.request('POST', `/api/transfers/${id}/send`, { body: { to: [], name: 'a' } });
    assert.deepEqual([unknown.status, nobody.status], [409, 400]);
  });
});

describe('hostile input', () => {
  it('rejects upload path traversal and writes nothing outside the stage', async (t) => {
    const ctx = await setup(t);
    const { id } = (await ctx.alice.request('POST', '/api/transfers')).json() as { id: string };
    for (const bad of ['../../evil.txt', 'a/../../evil2.txt', '..']) {
      assert.equal(await ctx.alice.upload(id, bad, 'x'), 400, bad);
    }
    const names = fs.readdirSync(ctx.settings.home, { recursive: true }).map(String);
    assert.ok(!names.some((n) => n.includes('evil')), names.join(', '));
    // A literal "%2e%2e" (one level of encoding only) is just an odd but harmless folder name.
    assert.equal(await ctx.alice.upload(id, '%2e%2e/ok.txt', 'x'), 201);
  });

  it("refuses uploads into someone else's transfer", async (t) => {
    const ctx = await setup(t);
    const { id } = (await ctx.alice.request('POST', '/api/transfers')).json() as { id: string };
    assert.equal(await ctx.bob.upload(id, 'a.txt', 'x'), 404);
  });

  it('requires a declared Content-Length for uploads', async (t) => {
    const ctx = await setup(t);
    const { id } = (await ctx.alice.request('POST', '/api/transfers')).json() as { id: string };
    const status = await new Promise<number>((resolve, reject) => {
      const request = http.request(
        { host: '127.0.0.1', port: ctx.port, method: 'POST', path: `/api/transfers/${id}/files`, headers: { 'X-Device': SECRET_A, 'X-File-Path': 'a.txt' } },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.on('error', reject);
      request.write('chunked body, no Content-Length'); // Node switches to chunked encoding
      request.end();
    });
    assert.equal(status, 411);
  });

  it('abort cleans up the stage', async (t) => {
    const ctx = await setup(t);
    const { id } = (await ctx.alice.request('POST', '/api/transfers')).json() as { id: string };
    await ctx.alice.upload(id, 'a.txt', 'x');
    assert.equal((await ctx.alice.request('DELETE', `/api/transfers/${id}`)).status, 200);
    await sleep(50);
    assert.ok(!fs.existsSync(path.join(ctx.settings.home, 'staging', id)));
  });

  it('survives a client that disconnects mid-upload', async (t) => {
    const ctx = await setup(t);
    const { id } = (await ctx.alice.request('POST', '/api/transfers')).json() as { id: string };
    await new Promise<void>((resolve) => {
      const request = http.request(
        { host: '127.0.0.1', port: ctx.port, method: 'POST', path: `/api/transfers/${id}/files`, headers: { 'X-Device': SECRET_A, 'X-File-Path': 'half.bin', 'Content-Length': '1000000' } },
        () => undefined,
      );
      request.on('error', () => resolve());
      request.write(Buffer.alloc(1000));
      setTimeout(() => {
        request.destroy();
        resolve();
      }, 100);
    });
    await sleep(200);
    assert.ok(!fs.existsSync(path.join(ctx.settings.home, 'staging', id, 'half.bin')), 'partial file removed');
    assert.equal((await ctx.alice.request('GET', '/api/health', { device: false })).status, 200, 'server still alive');
  });
});
