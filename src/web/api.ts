// Typed client for the server's API.
import type {
  CreateTransferResponse,
  ErrorResponse,
  InboxItem,
  RenameResponse,
  SendRequest,
  SendResponse,
} from '../shared/api.js';
import { secret } from './identity.js';

const authHeaders = { 'X-Device': secret };

async function parse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as Partial<ErrorResponse>).error ?? `Request failed (${response.status})`);
  return body as T;
}

const call = <T>(method: string, path: string, body?: object): Promise<T> =>
  fetch(path, {
    method,
    headers: body ? { ...authHeaders, 'Content-Type': 'application/json' } : authHeaders,
    ...(body && { body: JSON.stringify(body) }),
  }).then((response) => parse<T>(response));

export const eventsUrl = (name: string): string => `/api/events?id=${encodeURIComponent(secret)}&name=${encodeURIComponent(name)}`;
export const downloadUrl = (id: string): string => `/api/download/${id}?device=${encodeURIComponent(secret)}`;

export const rename = (name: string): Promise<RenameResponse> => call('POST', '/api/rename', { name });
export const createTransfer = (): Promise<CreateTransferResponse> => call('POST', '/api/transfers');
export const sendTransfer = (id: string, request: SendRequest): Promise<SendResponse> =>
  call('POST', `/api/transfers/${id}/send`, request);
export const abortTransfer = (id: string): Promise<unknown> => call('DELETE', `/api/transfers/${id}`);
export const fetchInbox = (): Promise<InboxItem[]> => call('GET', '/api/inbox');
export const dismissItem = (id: string): Promise<unknown> => call('DELETE', `/api/inbox/${id}`);

/** Upload one file into a transfer. XHR (not fetch) because it reports upload progress. */
export function uploadFile(transferId: string, path: string, file: File, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/transfers/${transferId}/files`);
    xhr.setRequestHeader('X-Device', secret);
    xhr.setRequestHeader('X-File-Path', encodeURIComponent(path));
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      if (xhr.status === 201) {
        onProgress(file.size);
        resolve();
      } else {
        reject(new Error(`Upload failed for ${path}`));
      }
    };
    xhr.onerror = () => reject(new Error(`Network error while uploading ${path}`));
    xhr.send(file);
  });
}
