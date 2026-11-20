// This browser's identity. It survives page refreshes via localStorage.

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode / storage blocked: fall back to a per-page identity
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/**
 * crypto.randomUUID() only exists on secure pages (https or localhost). A phone using
 * http://192.168.x.x doesn't have it, so build the id from getRandomValues instead.
 */
function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function loadSecret(): string {
  const existing = read('eazy-id');
  if (existing) return existing;
  const created = newId();
  write('eazy-id', created);
  return created;
}

/** Private id that authorises this device's own requests. Never shown to other devices. */
export const secret = loadSecret();

export const savedName = (): string => read('eazy-name') ?? '';
export const saveName = (name: string): void => write('eazy-name', name);
