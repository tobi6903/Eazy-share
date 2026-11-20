import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { unzipSync } from 'fflate';
import { makeTempSettings, SECRET_A, SECRET_B } from '../testing/helpers.js';
import { DeviceRegistry } from './devices.js';
import { BadRequest, Conflict, NotFound } from './errors.js';
import type { Subscriber } from './events.js';
import { TransferService } from './transfers.js';

class Mailbox implements Subscriber {
  readonly events: string[] = [];
  push(event: string): void {
    this.events.push(event);
  }
}

describe('TransferService', () => {
  let service: TransferService;
  let bobPid: string;
  let alicePid: string;
  let bobMail: Mailbox;

  let cleanup: () => void;

  beforeEach(() => {
    const registry = new DeviceRegistry(100);
    alicePid = registry.connect(SECRET_A, 'Alice', new Mailbox()).pid;
    bobMail = new Mailbox();
    bobPid = registry.connect(SECRET_B, 'Bob', bobMail).pid;
    const temp = makeTempSettings({ stageTtlMs: 1000, transferTtlMs: 1000 });
    cleanup = temp.cleanup;
    service = new TransferService(temp.settings, registry);
  });

  afterEach(() => cleanup());

  const stageWith = (files: Record<string, string>): string => {
    const id = service.createStage(SECRET_A);
    for (const [relative, content] of Object.entries(files)) {
      fs.writeFileSync(service.stageTarget(SECRET_A, id, relative), content);
    }
    return id;
  };

  it('zips folder structure and fills the recipient inbox', async () => {
    const id = stageWith({ 'trip/day1/a.txt': 'beach', 'trip/b.txt': 'hills' });
    const transfer = await service.send(SECRET_A, id, [bobPid], 'trip');

    assert.equal(transfer.name, 'trip.zip');
    const entries = unzipSync(fs.readFileSync(transfer.zipPath));
    assert.deepEqual(Object.keys(entries).sort(), ['trip/b.txt', 'trip/day1/a.txt']);
    assert.equal(Buffer.from(entries['trip/day1/a.txt'] as Uint8Array).toString(), 'beach');

    assert.deepEqual(service.inbox(SECRET_B).map((i) => i.name), ['trip.zip']);
    assert.equal(service.inbox(SECRET_B)[0]?.from, 'Alice');
    assert.deepEqual(service.inbox(SECRET_A), [], 'the sender does not receive it');
  });

  it('notifies the recipient', async () => {
    const id = stageWith({ 'a.txt': 'x' });
    await service.send(SECRET_A, id, [bobPid], 'a');
    assert.ok(bobMail.events.includes('inbox'));
  });

  it('removes the staging area once sent', async () => {
    const id = stageWith({ 'a.txt': 'x' });
    const target = service.stageTarget(SECRET_A, id, 'a.txt');
    await service.send(SECRET_A, id, [bobPid], 'a');
    assert.ok(!fs.existsSync(target));
  });

  it('does not double the .zip suffix', async () => {
    const id = stageWith({ 'a.txt': 'x' });
    assert.equal((await service.send(SECRET_A, id, [bobPid], 'stuff.ZIP')).name, 'stuff.zip');
  });

  it('rejects path traversal while staging', () => {
    const id = service.createStage(SECRET_A);
    for (const bad of ['../evil.txt', 'a/../../evil.txt', '']) {
      assert.throws(() => service.stageTarget(SECRET_A, id, bad), BadRequest, bad);
    }
  });

  it("refuses other devices access to someone else's stage", () => {
    const id = service.createStage(SECRET_A);
    assert.throws(() => service.stageTarget(SECRET_B, id, 'a.txt'), NotFound);
  });

  it('needs recipients, files and online devices', async () => {
    const id = stageWith({ 'a.txt': 'x' });
    await assert.rejects(service.send(SECRET_A, id, [], 'a'), BadRequest);
    await assert.rejects(service.send(SECRET_A, id, ['not-a-device'], 'a'), Conflict);
    const empty = service.createStage(SECRET_A);
    await assert.rejects(service.send(SECRET_A, empty, [bobPid], 'a'), BadRequest);
  });

  it('allows a retry after a failed send', async () => {
    const id = stageWith({ 'a.txt': 'x' });
    await assert.rejects(service.send(SECRET_A, id, ['nope'], 'a'), Conflict);
    assert.equal((await service.send(SECRET_A, id, [bobPid], 'a')).name, 'a.zip');
  });

  it('refuses a second send while one is running', async () => {
    const id = stageWith({ 'a.txt': 'x' });
    const first = service.send(SECRET_A, id, [bobPid], 'a');
    await assert.rejects(service.send(SECRET_A, id, [bobPid], 'a'), Conflict);
    await first;
  });

  it('only recipients may download', async () => {
    const id = stageWith({ 'a.txt': 'x' });
    const transfer = await service.send(SECRET_A, id, [bobPid], 'a');
    assert.equal(service.transferForDownload(SECRET_B, transfer.id), transfer);
    for (const who of [SECRET_A, 'unknown-device-secret', '']) {
      assert.throws(() => service.transferForDownload(who, transfer.id), NotFound, who);
    }
  });

  it('deletes the zip when the last recipient dismisses it', async () => {
    const id = stageWith({ 'a.txt': 'x' });
    const transfer = await service.send(SECRET_A, id, [bobPid, alicePid], 'a');
    service.dismiss(SECRET_B, transfer.id);
    assert.ok(fs.existsSync(transfer.zipPath));
    service.dismiss(SECRET_A, transfer.id);
    assert.ok(!fs.existsSync(transfer.zipPath));
    assert.deepEqual(service.inbox(SECRET_A), []);
  });

  it('abort removes an unfinished stage', () => {
    const id = stageWith({ 'a.txt': 'x' });
    const target = service.stageTarget(SECRET_A, id, 'a.txt');
    service.abortStage(SECRET_A, id);
    assert.ok(!fs.existsSync(target));
  });

  it('sweep removes old stages and transfers', async () => {
    const oldStage = stageWith({ 'a.txt': 'x' });
    const oldTarget = service.stageTarget(SECRET_A, oldStage, 'a.txt');
    const id = stageWith({ 'b.txt': 'y' });
    const transfer = await service.send(SECRET_A, id, [bobPid], 'b');

    service.sweep(Date.now() + 10 * 24 * 3600_000);
    assert.ok(!fs.existsSync(oldTarget));
    assert.ok(!fs.existsSync(transfer.zipPath));
    assert.deepEqual(service.inbox(SECRET_B), []);
  });
});
