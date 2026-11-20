// The page's shared state, plus a minimal change-notification hook for the views.
import type { DeviceInfo } from '../shared/api.js';

export interface AppState {
  /** Other devices that are online right now (never includes this one). */
  devices: DeviceInfo[];
  /** Public ids of the devices ticked as recipients. */
  chosen: Set<string>;
  /** Files picked to send, keyed by their relative path (folders keep their structure). */
  picked: Map<string, File>;
  /** A send is in progress. */
  busy: boolean;
}

export const state: AppState = {
  devices: [],
  chosen: new Set(),
  picked: new Map(),
  busy: false,
};

const listeners = new Set<() => void>();

/** Run `listener` whenever `changed()` is called. */
export function onChange(listener: () => void): void {
  listeners.add(listener);
}

export function changed(): void {
  for (const listener of listeners) listener();
}
