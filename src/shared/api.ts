// Types shared by the server, the web page and the browser extension.
// Types only: nothing here exists at runtime, so every side can import it freely.

/** A device other people can send to. `pid` is public; the private secret never leaves its owner. */
export interface DeviceInfo {
  pid: string;
  name: string;
}

/** Payload of the `devices` server-sent event. */
export interface DevicesEvent {
  me: string;
  devices: DeviceInfo[];
}

/** One zip waiting in a device's inbox. `created` is epoch milliseconds. */
export interface InboxItem {
  id: string;
  name: string;
  size: number;
  from: string;
  created: number;
}

export interface CreateTransferResponse {
  id: string;
}

export interface SendRequest {
  to: string[];
  name: string;
}

export interface SendResponse {
  id: string;
  name: string;
  size: number;
  sentTo: number;
}

export interface RenameRequest {
  name: string;
}

export interface RenameResponse {
  name: string;
}

export interface ErrorResponse {
  error: string;
}

export interface HealthResponse {
  app: string;
  version: string;
}

/** Whether the background server is running, and where to reach it. */
export interface ServerStatus {
  running: boolean;
  pid: number | null;
  port: number | null;
  localUrl: string | null;
  lanUrls: string[];
}

/** Messages the extension sends to the native host. */
export type NativeRequest =
  | { command: 'ping' }
  | { command: 'status' }
  | { command: 'start'; port?: number }
  | { command: 'stop' };

export type NativeReply =
  | ({ ok: true } & Partial<ServerStatus> & { version?: string })
  | { ok: false; error: string };
