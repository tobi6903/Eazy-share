// "2 · Send to": the list of online devices with checkboxes.
import { byId, el } from './dom.js';
import { changed, onChange, state } from './state.js';

function render(): void {
  const list = byId('devices');
  list.replaceChildren();

  if (state.devices.length === 0) {
    list.append(el('li', 'empty', `No other devices online. Open ${location.origin} on another device on this network.`));
  }
  for (const device of state.devices) {
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.chosen.has(device.pid);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.chosen.add(device.pid);
      else state.chosen.delete(device.pid);
      changed();
    });
    // A class rather than CSS :has(input:checked), which older iOS/Android browsers lack.
    const label = el('label', state.chosen.has(device.pid) ? 'dev checked' : 'dev');
    label.append(checkbox, el('span', undefined, device.name));
    const item = el('li');
    item.append(label);
    list.append(item);
  }
}

export function initDeviceList(): void {
  onChange(render);
  byId('all').addEventListener('click', (event) => {
    event.preventDefault();
    for (const device of state.devices) state.chosen.add(device.pid);
    changed();
  });
  render();
}
