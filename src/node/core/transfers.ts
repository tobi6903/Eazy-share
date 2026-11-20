// Uploading into a private staging area, zipping, and delivering to recipients' inboxes.
//
// Life of a transfer:
//   createStage()  ->  (client uploads files into the stage)  ->  send()
// send() zips the stage, stores the zip, and drops it into each recipient's inbox.
// dismiss() removes it from one inbox; the zip is deleted once nobody has it any more.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { InboxItem } from '../../shared/api.js';
import { layout, type Settings } from './config.js';
import type { DeviceRegistry } from './devices.js';
import { BadRequest, Conflict, NotFound } from './errors.js';
import { isWithin, safeName, safeSegments, walkFiles } from './paths.js';
import { buildZip } from './zipper.js';

interface Stage {
  id: string;
  owner: string; // device secret
  dir: string;
  created: number;
  sending: boolean;
}

export interface Transfer {
  id: string;
  name: string;
  size: number;
  fromName: string;
  zipPath: string;
  recipients: Set<string>; // device secrets
  created: number;
}

const rmQuiet = (target: string): void => fs.rmSync(target, { recursive: true, force: true });

export class TransferService {
  private readonly stages = new Map<string, Stage>();
  private readonly transfers = new Map<string, Transfer>();
  private readonly stagingDir: string;
  private readonly zipsDir: string;

  constructor(
    private readonly settings: Settings,
    private readonly devices: DeviceRegistry,
  ) {
    ({ stagingDir: this.stagingDir, zipsDir: this.zipsDir } = layout(settings));
    // Start clean: leftovers from a previous run are forgotten (the inbox lives in memory).
    for (const dir of [this.stagingDir, this.zipsDir]) {
      rmQuiet(dir);
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // --- staging ---------------------------------------------------------------

  createStage(owner: string): string {
    const id = randomUUID();
    const dir = path.join(this.stagingDir, id);
    fs.mkdirSync(dir, { recursive: true });
    this.stages.set(id, { id, owner, dir, created: Date.now(), sending: false });
    return id;
  }

  private stageOf(owner: string, id: string): Stage {
    const stage = this.stages.get(id);
    if (!stage || stage.owner !== owner) throw new NotFound('transfer not found');
    return stage;
  }

  /** Where an uploaded file should be written. Creates parent folders. */
  stageTarget(owner: string, id: string, relativePath: string): string {
    const stage = this.stageOf(owner, id);
    const segments = safeSegments(relativePath);
    if (!segments) throw new BadRequest('bad path');
    const target = path.join(stage.dir, ...segments);
    if (!isWithin(stage.dir, target)) throw new BadRequest('bad path');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    return target;
  }

  abortStage(owner: string, id: string): void {
    const stage = this.stages.get(id);
    if (stage && stage.owner === owner && !stage.sending) this.dropStage(stage);
  }

  private dropStage(stage: Stage): void {
    this.stages.delete(stage.id);
    rmQuiet(stage.dir);
  }

  // --- sending ---------------------------------------------------------------

  async send(owner: string, id: string, toPids: readonly string[], name: string): Promise<Transfer> {
    const stage = this.stageOf(owner, id);
    if (stage.sending) throw new Conflict('already sending');
    stage.sending = true; // set synchronously, so a second request can't slip in

    const zipPath = path.join(this.zipsDir, `${stage.id}.zip`);
    let recipients: Set<string>;
    try {
      recipients = this.resolveRecipients(toPids);
      const files = walkFiles(stage.dir);
      if (files.length === 0) throw new BadRequest('no files were uploaded');
      await buildZip(files, zipPath);
    } catch (error) {
      stage.sending = false; // let the client retry
      rmQuiet(zipPath);
      throw error;
    }

    const transfer: Transfer = {
      id: stage.id,
      name: `${safeName(name, 'files').replace(/\.zip$/i, '')}.zip`,
      size: fs.statSync(zipPath).size,
      fromName: this.devices.get(owner)?.name ?? 'Unknown',
      zipPath,
      recipients,
      created: Date.now(),
    };
    this.transfers.set(transfer.id, transfer);
    this.dropStage(stage);
    for (const secret of recipients) this.devices.notify(secret, 'inbox');
    return transfer;
  }

  private resolveRecipients(toPids: readonly string[]): Set<string> {
    const wanted = [...new Set(toPids.map(String))];
    if (wanted.length === 0) throw new BadRequest('choose at least one device');
    const recipients = new Set<string>();
    for (const pid of wanted) {
      const secret = this.devices.secretForOnlinePid(pid);
      if (!secret) throw new Conflict('a selected device is no longer online');
      recipients.add(secret);
    }
    return recipients;
  }

  // --- inbox -----------------------------------------------------------------

  inbox(secret: string): InboxItem[] {
    return [...this.transfers.values()]
      .filter((t) => t.recipients.has(secret))
      .sort((a, b) => b.created - a.created)
      .map((t) => ({ id: t.id, name: t.name, size: t.size, from: t.fromName, created: t.created }));
  }

  transferForDownload(secret: string, id: string): Transfer {
    const transfer = this.transfers.get(id);
    if (!secret || !this.devices.get(secret) || !transfer || !transfer.recipients.has(secret)) {
      throw new NotFound('not found');
    }
    return transfer;
  }

  dismiss(secret: string, id: string): void {
    const transfer = this.transfers.get(id);
    if (!transfer || !transfer.recipients.delete(secret)) return;
    if (transfer.recipients.size === 0) this.dropTransfer(transfer);
    this.devices.notify(secret, 'inbox');
  }

  private dropTransfer(transfer: Transfer): void {
    this.transfers.delete(transfer.id);
    rmQuiet(transfer.zipPath);
  }

  // --- housekeeping ----------------------------------------------------------

  /** Delete unfinished uploads and old zips. */
  sweep(now: number = Date.now()): void {
    for (const stage of [...this.stages.values()]) {
      if (!stage.sending && now - stage.created > this.settings.stageTtlMs) this.dropStage(stage);
    }
    for (const transfer of [...this.transfers.values()]) {
      if (now - transfer.created > this.settings.transferTtlMs) this.dropTransfer(transfer);
    }
  }
}
