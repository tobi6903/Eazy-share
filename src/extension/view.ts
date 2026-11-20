// DOM rendering for the popup. Everything goes through textContent, never innerHTML.
import type { ServerStatus } from '../shared/api.js';
import { receiverSteps, troubleshooting } from './steps.js';

export type PopupState = 'loading' | 'running' | 'stopped' | 'setup';

const PILL_TEXT: Record<PopupState, string> = {
  loading: 'Checking…',
  running: 'Sharing',
  stopped: 'Stopped',
  setup: 'Setup needed',
};

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`popup.html is missing #${id}`);
  return element as T;
}

function listItem(title: string, detail: string): HTMLLIElement {
  const item = document.createElement('li');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const span = document.createElement('span');
  span.textContent = detail;
  item.append(strong, span);
  return item;
}

export function renderSteps(url: string | null): void {
  byId('steps').replaceChildren(...receiverSteps(url).map((s) => listItem(s.title, s.detail)));
}

export function renderTroubleshooting(): void {
  byId('trouble').replaceChildren(...troubleshooting().map((f) => listItem(f.q, f.a)));
}

export function renderState(state: PopupState, status: ServerStatus | null = null): void {
  const running = state === 'running' && status !== null;

  byId('pill').textContent = PILL_TEXT[state];
  byId('pill').dataset['state'] = state;
  byId('setup').hidden = state !== 'setup';
  byId('controls').hidden = state === 'setup';
  byId('running').hidden = !running;

  const toggle = byId<HTMLButtonElement>('toggle');
  toggle.disabled = state === 'loading';
  toggle.textContent = running ? 'Stop sharing' : 'Start sharing';
  toggle.classList.toggle('danger', running);

  const lan = running ? status.lanUrls : [];
  const url = running ? (lan[0] ?? status.localUrl) : null;
  byId('url').textContent = url ?? '';
  byId('otherUrls').textContent = lan.length > 1 ? `Other addresses: ${lan.slice(1).join(', ')}` : '';
  byId('noNetwork').hidden = !(running && lan.length === 0);
  renderSteps(url);
}

export function showError(message: string): void {
  byId('error').textContent = message;
  byId('error').hidden = message === '';
}
