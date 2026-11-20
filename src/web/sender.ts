// "Zip & send": upload to a private staging area, then the server zips and delivers.
import { abortTransfer, createTransfer, sendTransfer, uploadFile } from './api.js';
import { byId } from './dom.js';
import { formatSize, zipNameFor } from './format.js';
import { clearPicked } from './picker.js';
import { setStatus } from './notices.js';
import { changed, onChange, state } from './state.js';

const PARALLEL_UPLOADS = 3;

function renderButton(): void {
  byId<HTMLButtonElement>('send').disabled = state.picked.size === 0 || state.chosen.size === 0 || state.busy;
}

/** Upload every picked file (a few at a time), reporting overall progress as a 0..1 fraction. */
async function uploadAll(transferId: string, onProgress: (fraction: number) => void): Promise<void> {
  const queue = [...state.picked.entries()];
  const total = queue.reduce((sum, [, file]) => sum + file.size, 0) || 1;
  const loaded = new Map<string, number>();
  let failure: Error | undefined;

  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next && !failure; next = queue.shift()) {
      const [path, file] = next;
      try {
        await uploadFile(transferId, path, file, (n) => {
          loaded.set(path, n);
          onProgress(Math.min(1, [...loaded.values()].reduce((a, b) => a + b, 0) / total));
        });
      } catch (error) {
        failure = error as Error;
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_UPLOADS }, worker));
  if (failure) throw failure;
}

async function send(): Promise<void> {
  const bar = byId('bar');
  const fill = byId('fill');
  state.busy = true;
  changed();
  bar.classList.add('show');
  fill.style.width = '0';
  setStatus('Uploading…');

  let transferId: string | undefined;
  try {
    transferId = (await createTransfer()).id;
    await uploadAll(transferId, (fraction) => (fill.style.width = `${fraction * 100}%`));

    setStatus('Zipping…');
    const sent = await sendTransfer(transferId, { to: [...state.chosen], name: zipNameFor(state.picked.keys()) });
    fill.style.width = '100%';
    const plural = sent.sentTo > 1 ? 's' : '';
    setStatus(`Sent ${sent.name} (${formatSize(sent.size)}) to ${sent.sentTo} device${plural}.`, 'ok');
    clearPicked();
  } catch (error) {
    if (transferId) void abortTransfer(transferId).catch(() => undefined);
    setStatus((error as Error).message, 'err');
  } finally {
    state.busy = false;
    changed();
    window.setTimeout(() => bar.classList.remove('show'), 1500);
  }
}

export function initSender(): void {
  onChange(renderButton);
  byId('send').addEventListener('click', () => void send());
  renderButton();
}
