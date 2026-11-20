import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { beforeEach, describe, it } from 'node:test';
import type { NativeReply, ServerStatus } from '../../shared/api.js';
import { VERSION } from '../core/config.js';
import { ServerError } from '../runtime/controller.js';
import { handle, run, type ServerControl } from './host.js';
import { encodeMessage, readMessages } from './protocol.js';

const OFF: ServerStatus = { running: false, pid: null, port: null, localUrl: null, lanUrls: [] };

class FakeControl implements ServerControl {
  calls: string[] = [];
  async status(): Promise<ServerStatus> {
    this.calls.push('status');
    return OFF;
  }
  async start(port?: number): Promise<ServerStatus> {
    this.calls.push(`start:${port}`);
    if (port === 1) throw new ServerError('boom');
    if (port === 2) throw new TypeError('unexpected');
    return { running: true, pid: 7, port: port ?? 8787, localUrl: 'http://localhost:8787', lanUrls: ['http://1.2.3.4:8787'] };
  }
  async stop(): Promise<ServerStatus> {
    this.calls.push('stop');
    return OFF;
  }
}

describe('native host', () => {
  let control: FakeControl;
  beforeEach(() => {
    control = new FakeControl();
  });

  it('answers ping', async () => {
    assert.deepEqual(await handle({ command: 'ping' }, control), { ok: true, version: VERSION });
  });

  it('returns server status fields', async () => {
    const reply = await handle({ command: 'start' }, control);
    assert.deepEqual(reply, { ok: true, running: true, pid: 7, port: 8787, localUrl: 'http://localhost:8787', lanUrls: ['http://1.2.3.4:8787'] });
  });

  it('passes a port through only if it is an integer', async () => {
    await handle({ command: 'start', port: 9000 }, control);
    await handle({ command: 'start', port: '9000' }, control);
    await handle({ command: 'start', port: 1.5 }, control);
    assert.deepEqual(control.calls, ['start:9000', 'start:undefined', 'start:undefined']);
  });

  it('turns failures into error replies', async () => {
    assert.deepEqual(await handle({ command: 'start', port: 1 }, control), { ok: false, error: 'boom' });
    const unexpected = await handle({ command: 'start', port: 2 }, control);
    assert.equal(unexpected.ok, false);
    assert.match((unexpected as { error: string }).error, /TypeError: unexpected/);
  });

  it('rejects unknown commands', async () => {
    assert.equal((await handle({ command: 'rm -rf' }, control)).ok, false);
    assert.equal((await handle({}, control)).ok, false);
  });

  it('answers every message until the pipe closes', async () => {
    const input = Readable.from([encodeMessage({ command: 'status' }), encodeMessage({ command: 'stop' })]);
    const written: Buffer[] = [];
    await run(input, { write: (chunk) => written.push(chunk) }, control);
    assert.deepEqual(control.calls, ['status', 'stop']);
    const replies: unknown[] = [];
    for await (const reply of readMessages(Readable.from(written))) replies.push(reply);
    assert.equal(replies.length, 2);
  });

  it('reports protocol errors instead of crashing', async () => {
    const bad = Buffer.alloc(4);
    bad.writeUInt32LE(2 ** 31);
    const written: Buffer[] = [];
    await run(Readable.from([bad]), { write: (chunk) => written.push(chunk) }, control);
    const [reply] = await (async () => {
      const out: NativeReply[] = [];
      for await (const message of readMessages(Readable.from(written))) out.push(message as unknown as NativeReply);
      return out;
    })();
    assert.equal(reply?.ok, false);
  });
});
