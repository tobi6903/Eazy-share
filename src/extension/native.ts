// Talks to the local server through Chrome native messaging.
// Each call starts the host, sends one command, gets one reply, and the host exits;
// the server itself keeps running in the background.
import type { NativeReply, NativeRequest, ServerStatus } from '../shared/api.js';
import { HOST_NAME } from './config.js';

/** The native host isn't registered (or this extension isn't allowed to use it). */
export class HostMissingError extends Error {}

/** The host ran but reported a failure. */
export class HostError extends Error {}

const MISSING = /not found|forbidden/i;

export function sendCommand(request: NativeRequest): Promise<NativeReply & { ok: true }> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(HOST_NAME, request, (reply?: NativeReply) => {
      const problem = chrome.runtime.lastError;
      if (problem) {
        const message = problem.message ?? 'Could not reach the Eazy-share host.';
        reject(MISSING.test(message) ? new HostMissingError(message) : new HostError(message));
      } else if (!reply) {
        reject(new HostError('The Eazy-share host sent no reply.'));
      } else if (!reply.ok) {
        reject(new HostError(reply.error || 'Unknown error.'));
      } else {
        resolve(reply);
      }
    });
  });
}

/** Replies to status/start/stop always include every ServerStatus field. */
const asStatus = (reply: NativeReply & { ok: true }): ServerStatus => ({
  running: reply.running ?? false,
  pid: reply.pid ?? null,
  port: reply.port ?? null,
  localUrl: reply.localUrl ?? null,
  lanUrls: reply.lanUrls ?? [],
});

export const getStatus = async (): Promise<ServerStatus> => asStatus(await sendCommand({ command: 'status' }));
export const startServer = async (): Promise<ServerStatus> => asStatus(await sendCommand({ command: 'start' }));
export const stopServer = async (): Promise<ServerStatus> => asStatus(await sendCommand({ command: 'stop' }));
