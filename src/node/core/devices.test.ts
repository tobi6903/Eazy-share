import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sleep, SECRET_A, SECRET_B } from '../testing/helpers.js';
import { DeviceRegistry } from './devices.js';
import { BadRequest, Unauthorized } from './errors.js';
import type { Subscriber } from './events.js';

class Mailbox implements Subscriber {
  readonly received: { event: string; data?: object }[] = [];
  push(event: string, data?: object): void {
    this.received.push({ event, ...(data && { data }) });
  }
}

const newRegistry = (): DeviceRegistry => new DeviceRegistry(100);

describe('DeviceRegistry', () => {
  it('connect makes a device online with a default name', () => {
    const registry = newRegistry();
    const device = registry.connect(SECRET_A, '', new Mailbox());
    assert.ok(device.online);
    assert.ok(device.name.length > 0);
    assert.deepEqual(registry.onlineList(), [device.info()]);
  });

  it('never exposes the secret in the public list', () => {
    const registry = newRegistry();
    registry.connect(SECRET_A, 'Alice', new Mailbox());
    assert.ok(!JSON.stringify(registry.onlineList()).includes(SECRET_A));
  });

  it('rejects a malformed secret', () => {
    assert.throws(() => newRegistry().connect('short', 'x', new Mailbox()), BadRequest);
  });

  it('treats the same secret as the same device across reconnects', () => {
    const registry = newRegistry();
    const first = registry.connect(SECRET_A, 'Alice', new Mailbox());
    const second = registry.connect(SECRET_A, '', new Mailbox());
    assert.equal(first, second);
    assert.equal(second.name, 'Alice');
  });

  it('goes offline only after the grace period', async () => {
    const registry = newRegistry();
    const box = new Mailbox();
    const device = registry.connect(SECRET_A, 'Alice', box);
    registry.disconnect(device, box);
    assert.ok(device.online, 'still within grace');
    await sleep(300);
    assert.ok(!device.online);
    assert.deepEqual(registry.onlineList(), []);
  });

  it('stays online if it reconnects within the grace period', async () => {
    const registry = newRegistry();
    const box = new Mailbox();
    const device = registry.connect(SECRET_A, 'Alice', box);
    registry.disconnect(device, box);
    registry.connect(SECRET_A, '', new Mailbox());
    await sleep(300);
    assert.ok(device.online);
  });

  it('a second tab keeps the device online', async () => {
    const registry = newRegistry();
    const tab1 = new Mailbox();
    const device = registry.connect(SECRET_A, 'Alice', tab1);
    registry.connect(SECRET_A, '', new Mailbox());
    registry.disconnect(device, tab1);
    await sleep(300);
    assert.ok(device.online);
  });

  it('tells everyone when a device joins', () => {
    const registry = newRegistry();
    const alice = new Mailbox();
    registry.connect(SECRET_A, 'Alice', alice);
    alice.received.length = 0;
    registry.connect(SECRET_B, 'Bob', new Mailbox());
    assert.equal(alice.received.length, 1);
    assert.equal(alice.received[0]?.event, 'devices');
    assert.match(JSON.stringify(alice.received[0]?.data), /Bob/);
  });

  it('renames, rejecting blank names', () => {
    const registry = newRegistry();
    registry.connect(SECRET_A, 'Alice', new Mailbox());
    assert.equal(registry.rename(SECRET_A, "  Alice's Mac "), "Alice's Mac");
    assert.throws(() => registry.rename(SECRET_A, '   '), BadRequest);
  });

  it('require() rejects unknown devices', () => {
    const registry = newRegistry();
    for (const bad of [undefined, null, '', 'nope']) assert.throws(() => registry.require(bad), Unauthorized);
  });

  it('resolves only online devices by public id', async () => {
    const registry = newRegistry();
    const box = new Mailbox();
    const device = registry.connect(SECRET_A, 'Alice', box);
    assert.equal(registry.secretForOnlinePid(device.pid), SECRET_A);
    registry.disconnect(device, box);
    await sleep(300);
    assert.equal(registry.secretForOnlinePid(device.pid), undefined);
  });
});
