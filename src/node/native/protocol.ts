// Chrome's native-messaging wire format: a 4-byte length (native byte order), then UTF-8 JSON.
import os from 'node:os';

/** Chrome's own limit for host -> browser messages. */
export const MAX_MESSAGE_BYTES = 1024 * 1024;

const LITTLE_ENDIAN = os.endianness() === 'LE';

export class ProtocolError extends Error {}

export function encodeMessage(message: object): Buffer {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  if (payload.length > MAX_MESSAGE_BYTES) throw new ProtocolError('reply too large');
  const header = Buffer.alloc(4);
  if (LITTLE_ENDIAN) header.writeUInt32LE(payload.length);
  else header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}

function parse(payload: Buffer): Record<string, unknown> {
  let message: unknown;
  try {
    message = JSON.parse(payload.toString('utf8'));
  } catch (error) {
    throw new ProtocolError(`invalid JSON: ${(error as Error).message}`);
  }
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    throw new ProtocolError('message must be a JSON object');
  }
  return message as Record<string, unknown>;
}

/** Messages from the browser, one per yield, until it closes the pipe. Copes with split reads. */
export async function* readMessages(stream: AsyncIterable<Buffer | string>): AsyncGenerator<Record<string, unknown>> {
  let buffer = Buffer.alloc(0);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    while (buffer.length >= 4) {
      const length = LITTLE_ENDIAN ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0);
      if (length > MAX_MESSAGE_BYTES) throw new ProtocolError(`message too large (${length} bytes)`);
      if (buffer.length < 4 + length) break; // wait for the rest
      yield parse(buffer.subarray(4, 4 + length));
      buffer = buffer.subarray(4 + length);
    }
  }
  if (buffer.length > 0) throw new ProtocolError('truncated message');
}
