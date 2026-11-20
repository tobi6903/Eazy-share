// Popup controller: wires the buttons to the native host and the view.
import type { ServerStatus } from '../shared/api.js';
import { INSTALL_COMMAND } from './config.js';
import { getStatus, HostMissingError, startServer, stopServer } from './native.js';
import { byId, renderState, renderTroubleshooting, showError } from './view.js';

let status: ServerStatus | null = null;

function apply(next: ServerStatus): void {
  status = next;
  renderState(next.running ? 'running' : 'stopped', next);
}

function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof HostMissingError) {
    renderState('setup');
    byId('hostError').textContent = message;
  } else {
    showError(message);
    renderState(status?.running ? 'running' : 'stopped', status);
  }
}

async function run(action: () => Promise<ServerStatus>, busyLabel: string): Promise<void> {
  showError('');
  const toggle = byId<HTMLButtonElement>('toggle');
  toggle.disabled = true;
  toggle.textContent = busyLabel;
  try {
    apply(await action());
  } catch (error) {
    fail(error);
  }
}

async function copy(text: string, button: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => (button.textContent = original), 1200);
  } catch {
    showError('Could not copy. Select the text and copy it manually.');
  }
}

async function init(): Promise<void> {
  byId('command').textContent = INSTALL_COMMAND;
  renderTroubleshooting();
  renderState('loading');
  try {
    apply(await getStatus());
  } catch (error) {
    fail(error);
  }
}

byId('toggle').addEventListener('click', () => {
  void (status?.running ? run(stopServer, 'Stopping…') : run(startServer, 'Starting…'));
});
byId('open').addEventListener('click', () => {
  if (status?.localUrl) void chrome.tabs.create({ url: status.localUrl });
});
byId('copy').addEventListener('click', () => void copy(byId('url').textContent ?? '', byId('copy')));
byId('copyCommand').addEventListener('click', () => void copy(INSTALL_COMMAND, byId('copyCommand')));
byId('retry').addEventListener('click', () => void init());

void init();
