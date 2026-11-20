// The native-messaging host: answers commands from the extension.
//
// Commands (JSON in, JSON out), see NativeRequest / NativeReply in shared/api.ts:
//   {command: 'ping'}                -> {ok: true, version}
//   {command: 'status'}              -> {ok: true, ...ServerStatus}
//   {command: 'start', port?: n}     -> {ok: true, ...ServerStatus}
//   {command: 'stop'}                -> {ok: true, ...ServerStatus}
// Failures come back as {ok: false, error}.
//
// stdout belongs to the protocol: never console.log() anything in here.
import type { NativeReply, ServerStatus } from '../../shared/api.js';
import { VERSION } from '../core/config.js';
import { ServerError } from '../runtime/controller.js';
import { encodeMessage, ProtocolError, readMessages } from './protocol.js';

/** What the host needs from the server controller (a fake can stand in for it in tests). */
export interface ServerControl {
  status(): Promise<ServerStatus>;
  start(port?: number): Promise<ServerStatus>;
  stop(): Promise<ServerStatus>;
}

export async function handle(message: Record<string, unknown>, control: ServerControl): Promise<NativeReply> {
  const command = message['command'];
  try {
    switch (command) {
      case 'ping':
        return { ok: true, version: VERSION };
      case 'status':
        return { ok: true, ...(await control.status()) };
      case 'start': {
        const port = message['port'];
        return { ok: true, ...(await control.start(Number.isInteger(port) ? (port as number) : undefined)) };
      }
      case 'stop':
        return { ok: true, ...(await control.stop()) };
      default:
        return { ok: false, error: `unknown command: ${String(command)}` };
    }
  } catch (error) {
    // Never let the host crash silently: the popup shows this text.
    const text = error instanceof ServerError ? error.message : `${(error as Error).name}: ${(error as Error).message}`;
    return { ok: false, error: text };
  }
}

/** Serve requests until the browser closes the pipe. */
export async function run(
  input: AsyncIterable<Buffer | string>,
  output: { write(chunk: Buffer): unknown },
  control: ServerControl,
): Promise<void> {
  try {
    for await (const message of readMessages(input)) {
      output.write(encodeMessage(await handle(message, control)));
    }
  } catch (error) {
    if (!(error instanceof ProtocolError)) throw error;
    output.write(encodeMessage({ ok: false, error: error.message } satisfies NativeReply));
  }
}
