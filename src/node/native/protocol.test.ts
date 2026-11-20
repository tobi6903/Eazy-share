import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import { encodeMessage, MAX_MESSAGE_BYTES, ProtocolError, readMessages } from './protocol.js';

const collect = async (chunks: Buffer[]): Promise<unknown[]> => {
  const out: unknown[] = [];
  for await (const message of readMessages(Readable.from(chunks))) out.push(message);
  return out;
};

describe('native-messaging protocol', () => {
  it('round-trips a message', async () => {
    assert.deepEqual(await collect([encodeMessage({ command: 'status', n: 1 })]), [{ command: 'status', n: 1 }]);
  });

  it('reads several messages from one chunk', async () => {
    const both = Buffer.concat([encodeMessage({ a: 1 }), encodeMessage({ b: 2 })]);
    assert.deepEqual(await collect([both]), [{ a: 1 }, { b: 2 }]);
  });

  it('reassembles a message split across reads, even mid-header', async () => {
    const whole = encodeMessage({ command: 'ping' });
    assert.deepEqual(await collect([whole.subarray(0, 2), whole.subarray(2, 7), whole.subarray(7)]), [{ command: 'ping' }]);
  });

  it('handles non-ASCII text', async () => {
    assert.deepEqual(await collect([encodeMessage({ name: 'Bobの📱' })]), [{ name: 'Bobの📱' }]);
  });

  it('yields nothing at EOF', async () => {
    assert.deepEqual(await collect([]), []);
  });

  it('rejects oversized, truncated and malformed messages', async () => {
    const huge = Buffer.alloc(4);
    huge.writeUInt32LE(MAX_MESSAGE_BYTES + 1);
    await assert.rejects(collect([huge]), ProtocolError);
    await assert.rejects(collect([encodeMessage({ a: 1 }).subarray(0, 6)]), ProtocolError);

    const header = Buffer.alloc(4);
    header.writeUInt32LE(8);
    await assert.rejects(collect([Buffer.concat([header, Buffer.from('not json')])]), ProtocolError);
    await assert.rejects(collect([encodeMessage([1, 2] as unknown as object)]), ProtocolError);
  });

  it('refuses to send a reply that is too large', () => {
    assert.throws(() => encodeMessage({ blob: 'x'.repeat(MAX_MESSAGE_BYTES) }), ProtocolError);
  });
});
