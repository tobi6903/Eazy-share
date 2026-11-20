// Server-Sent Events plumbing: the subscriber contract and the wire format.

/** One open event stream. The core pushes events; the HTTP layer writes them to the socket. */
export interface Subscriber {
  push(event: string, data?: object): void;
}

export function formatSse(event: string, data: object = {}): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
