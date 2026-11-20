// Transient messages: the toast and the status line under the send button.
import { byId } from './dom.js';

let toastTimer: number | undefined;

export function toast(message: string): void {
  const element = byId('toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element.classList.remove('show'), 4000);
}

export function setStatus(message: string, kind: 'ok' | 'err' | '' = ''): void {
  const element = byId('status');
  element.textContent = message;
  element.className = `status ${kind}`;
}
