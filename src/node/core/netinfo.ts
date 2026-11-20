// Finding this computer's address on the local network.
import os from 'node:os';

type Interfaces = ReturnType<typeof os.networkInterfaces>;

const PRIVATE = [/^192\.168\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./];

/**
 * Adapters that exist on the computer but that other devices on your Wi-Fi can't reach:
 * virtual machines, containers, WSL/Hyper-V, VPN tunnels, Apple's peer-to-peer interfaces.
 */
const VIRTUAL = /vethernet|virtualbox|vmware|vmnet|vbox|hyper-v|wsl|docker|veth|virbr|^br-|^bridge|^utun|^awdl|^llw|tailscale|zerotier|loopback|bluetooth/i;

/**
 * IPv4 addresses other devices on the network could use, most likely first:
 * real private-network adapters, then other real ones, then virtual adapters.
 */
export function lanAddresses(interfaces: Interfaces = os.networkInterfaces()): string[] {
  const found: { address: string; rank: number }[] = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const info of addresses ?? []) {
      if (info.family !== 'IPv4' || info.internal || info.address.startsWith('169.254.')) continue;
      const isPrivate = PRIVATE.some((re) => re.test(info.address));
      found.push({ address: info.address, rank: VIRTUAL.test(name) ? 2 : isPrivate ? 0 : 1 });
    }
  }
  // Array.prototype.sort is stable, so the OS's own order breaks ties.
  const sorted = found.sort((a, b) => a.rank - b.rank).map((entry) => entry.address);
  return [...new Set(sorted)];
}

export function urlsFor(port: number): string[] {
  return lanAddresses().map((ip) => `http://${ip}:${port}`);
}
