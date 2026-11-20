// Who is online. A device is a browser identified by a private secret it keeps in localStorage.
// Other devices only ever see the public `pid`; the secret authorises that device's own actions.
import { randomBytes } from 'node:crypto';
import type { DeviceInfo, DevicesEvent } from '../../shared/api.js';
import { BadRequest, Unauthorized } from './errors.js';
import type { Subscriber } from './events.js';
import { cleanLabel } from './paths.js';

const SECRET_RE = /^[A-Za-z0-9-]{16,64}$/;
const ADJECTIVES = ['Swift', 'Calm', 'Bright', 'Brave', 'Lucky', 'Quiet', 'Witty', 'Sunny', 'Gentle', 'Bold'];
const ANIMALS = ['Panda', 'Otter', 'Falcon', 'Koala', 'Tiger', 'Dolphin', 'Fox', 'Heron', 'Lynx', 'Gecko'];

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)] as T;
export const randomName = (): string => `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;

export function assertValidSecret(secret: string): void {
  if (!SECRET_RE.test(secret)) throw new BadRequest('bad id');
}

export class Device {
  /** Public id, safe to show to other devices. */
  readonly pid = randomBytes(6).toString('hex');
  readonly subscribers = new Set<Subscriber>();
  online = false;
  offlineTimer: NodeJS.Timeout | undefined;

  constructor(
    readonly secret: string,
    public name: string,
  ) {}

  info(): DeviceInfo {
    return { pid: this.pid, name: this.name };
  }
}

export class DeviceRegistry {
  private readonly devices = new Map<string, Device>();

  constructor(private readonly graceMs = 3000) {}

  // --- lookups ---------------------------------------------------------------

  get(secret: string | undefined | null): Device | undefined {
    return secret ? this.devices.get(secret) : undefined;
  }

  require(secret: string | undefined | null): Device {
    const device = this.get(secret);
    if (!device) throw new Unauthorized('unknown device, reload the page');
    return device;
  }

  onlineList(): DeviceInfo[] {
    return [...this.devices.values()].filter((d) => d.online).map((d) => d.info());
  }

  secretForOnlinePid(pid: string): string | undefined {
    for (const device of this.devices.values()) {
      if (device.pid === pid && device.online) return device.secret;
    }
    return undefined;
  }

  // --- presence --------------------------------------------------------------

  connect(secret: string, name: string, subscriber: Subscriber): Device {
    assertValidSecret(secret);
    const requested = cleanLabel(name);
    let device = this.devices.get(secret);
    if (!device) {
      device = new Device(secret, requested || randomName());
      this.devices.set(secret, device);
    } else if (requested) {
      device.name = requested;
    }
    clearTimeout(device.offlineTimer);
    device.offlineTimer = undefined;
    device.subscribers.add(subscriber);
    device.online = true;
    this.broadcast();
    return device;
  }

  disconnect(device: Device, subscriber: Subscriber): void {
    device.subscribers.delete(subscriber);
    if (device.subscribers.size > 0) return;
    // Grace period so a page refresh doesn't flash the device offline.
    device.offlineTimer = setTimeout(() => this.markOffline(device), this.graceMs);
    device.offlineTimer.unref();
  }

  private markOffline(device: Device): void {
    if (device.subscribers.size === 0 && device.online) {
      device.online = false;
      this.broadcast();
    }
  }

  rename(secret: string, name: string): string {
    const cleaned = cleanLabel(name);
    if (!cleaned) throw new BadRequest('name required');
    this.require(secret).name = cleaned;
    this.broadcast();
    return cleaned;
  }

  // --- messaging -------------------------------------------------------------

  notify(secret: string, event: string): void {
    for (const subscriber of this.devices.get(secret)?.subscribers ?? []) subscriber.push(event);
  }

  private broadcast(): void {
    const devices = this.onlineList();
    for (const device of this.devices.values()) {
      const payload: DevicesEvent = { me: device.pid, devices };
      for (const subscriber of device.subscribers) subscriber.push('devices', payload);
    }
  }
}
