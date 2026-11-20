// "Received": zips other devices sent to this one.
import { dismissItem, downloadUrl, fetchInbox } from './api.js';
import { byId, el } from './dom.js';
import { formatSize, formatTime } from './format.js';
import { toast } from './notices.js';
import type { InboxItem } from '../shared/api.js';

/** Ids already seen, so only genuinely new arrivals get a notification. Null until the first load. */
let seen: Set<string> | null = null;

function renderItem(item: InboxItem, isNew: boolean): HTMLLIElement {
  const info = el('div', 'info');
  const name = el('div', 'name', item.name);
  name.title = item.name;
  info.append(name, el('div', 'meta', `from ${item.from} · ${formatSize(item.size)} · ${formatTime(item.created)}`));

  const download = el('a', 'btn primary', 'Download');
  download.href = downloadUrl(item.id);

  const dismiss = el('button', 'btn del', 'Dismiss');
  dismiss.addEventListener('click', async () => {
    await dismissItem(item.id);
    await loadInbox();
  });

  const row = el('li', `item${isNew ? ' new' : ''}`);
  row.append(info, download, dismiss);
  return row;
}

export async function loadInbox(): Promise<void> {
  let items: InboxItem[];
  try {
    items = await fetchInbox();
  } catch {
    return; // not connected yet, or the server is gone: the next event retries
  }

  const fresh = seen ? items.filter((item) => !seen?.has(item.id)) : [];
  const first = fresh[0];
  if (first) toast(`New file from ${first.from}: ${first.name}`);
  seen = new Set(items.map((item) => item.id));

  const list = byId('inbox');
  list.replaceChildren();
  if (items.length === 0) {
    list.append(el('li', 'empty', 'Nothing received yet.'));
    return;
  }
  const freshIds = new Set(fresh.map((item) => item.id));
  for (const item of items) list.append(renderItem(item, freshIds.has(item.id)));
}
