// The application core: wires the services together. No HTTP in here.
import type { Settings } from './config.js';
import { DeviceRegistry } from './devices.js';
import { TransferService } from './transfers.js';

export class EazyShareApp {
  readonly devices: DeviceRegistry;
  readonly transfers: TransferService;
  private janitor: NodeJS.Timeout | undefined;

  constructor(readonly settings: Settings) {
    this.devices = new DeviceRegistry(settings.presenceGraceMs);
    this.transfers = new TransferService(settings, this.devices);
  }

  startBackgroundTasks(): void {
    this.janitor = setInterval(() => this.transfers.sweep(), this.settings.sweepIntervalMs);
    this.janitor.unref();
  }

  stopBackgroundTasks(): void {
    clearInterval(this.janitor);
  }
}
