// "1 · Pick files or a folder": file inputs and drag-and-drop (folders included).
import { byId } from './dom.js';
import { formatSize } from './format.js';
import { setStatus } from './notices.js';
import { changed, onChange, state } from './state.js';

interface Picked {
  file: File;
  /** Path inside the zip, e.g. 'trip/day1/a.txt'. */
  path: string;
}

function add(items: Picked[]): void {
  for (const item of items) state.picked.set(item.path, item.file);
  changed();
}

export function clearPicked(): void {
  state.picked.clear();
  changed();
}

function renderSummary(): void {
  byId('picked').hidden = state.picked.size === 0;
  if (state.picked.size === 0) return;

  let total = 0;
  const tops = new Set<string>();
  for (const [path, file] of state.picked) {
    total += file.size;
    tops.add(path.split('/')[0] ?? path);
  }
  const names = [...tops];
  const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '');
  const count = state.picked.size;
  byId('pickedText').textContent = `${count} file${count > 1 ? 's' : ''} · ${formatSize(total)} · ${shown}`;
}

/** Walk a dropped file or folder (FileSystemEntry) and collect every file in it. */
async function walkEntry(entry: FileSystemEntry, out: Picked[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ file, path: entry.fullPath.replace(/^\//, '') });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) break;
      for (const child of batch) await walkEntry(child, out);
    }
  }
}

function fromInput(input: HTMLInputElement, pathOf: (file: File) => string): void {
  input.addEventListener('change', () => {
    add([...(input.files ?? [])].map((file) => ({ file, path: pathOf(file) })));
    input.value = '';
  });
}

/**
 * Phones and tablets can't pick whole folders or drag-and-drop, so don't offer what won't work:
 * show only "Choose files" and point folder-senders to a computer.
 */
function adaptToTouchDevices(): void {
  if (!window.matchMedia('(pointer: coarse)').matches) return;
  byId('folderLabel').hidden = true;
  byId('dropHint').textContent = 'Choose the files to send';
  byId('touchNote').hidden = false;
}

export function initPicker(): void {
  adaptToTouchDevices();
  onChange(renderSummary);
  fromInput(byId<HTMLInputElement>('pickFiles'), (file) => file.name);
  fromInput(byId<HTMLInputElement>('pickFolder'), (file) => file.webkitRelativePath || file.name);
  byId('clear').addEventListener('click', () => {
    clearPicked();
    setStatus('');
  });

  const drop = byId('drop');
  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add('over');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.remove('over');
    });
  }
  drop.addEventListener('drop', async (event) => {
    const transfer = (event as DragEvent).dataTransfer;
    if (!transfer) return;
    // Entries must be grabbed synchronously, before the first await.
    const entries = [...transfer.items]
      .filter((item) => item.kind === 'file')
      .map((item) => item.webkitGetAsEntry?.() ?? null)
      .filter((entry): entry is FileSystemEntry => entry !== null);
    const found: Picked[] = [];
    try {
      if (entries.length) for (const entry of entries) await walkEntry(entry, found);
      else for (const file of transfer.files) found.push({ file, path: file.name });
      add(found);
    } catch {
      setStatus('Could not read the dropped items.', 'err');
    }
  });
  renderSummary();
}
