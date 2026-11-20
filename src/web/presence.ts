// Presence: an open event stream tells the server this device is online,
// and tells us which other devices are.
import type { DevicesEvent } from '../shared/api.js';
import { eventsUrl, rename } from './api.js';
import { byId } from './dom.js';
import { saveName, savedName } from './identity.js';
import { changed, state } from './state.js';

export interface PresenceHooks {
  /** The inbox may have changed (connected, reconnected, or a file arrived). */
  onInboxChange(): void;
}

export function connectPresence(hooks: PresenceHooks): void {
  const nameInput = byId<HTMLInputElement>('myName');
  const dot = byId('dot');
  nameInput.value = savedName();

  const source = new EventSource(eventsUrl(savedName()));
  source.onopen = () => {
    dot.classList.add('on');
    hooks.onInboxChange();
  };
  source.onerror = () => dot.classList.remove('on');
  source.addEventListener('inbox', () => hooks.onInboxChange());
  source.addEventListener('devices', (event) => {
    const { me, devices } = JSON.parse((event as MessageEvent<string>).data) as DevicesEvent;
    state.devices = devices.filter((d) => d.pid !== me);
    for (const pid of [...state.chosen]) {
      if (!state.devices.some((d) => d.pid === pid)) state.chosen.delete(pid);
    }
    const mine = devices.find((d) => d.pid === me);
    if (mine && document.activeElement !== nameInput) {
      nameInput.value = mine.name;
      saveName(mine.name);
    }
    changed();
  });

  nameInput.addEventListener('change', () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.value = savedName();
      return;
    }
    saveName(name);
    void rename(name);
  });
}
