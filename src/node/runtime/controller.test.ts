import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { describe, it } from 'node:test';
import { layout } from '../core/config.js';
import { tempSettings } from '../testing/helpers.js';
import { findFreePort, ServerController, ServerError } from './controller.js';

/** Occupy a port for the duration of the test. */
function occupy(t: { after(fn: () => void): void }): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, '0.0.0.0', () => {
      t.after(() => server.close());
      resolve((server.address() as net.AddressInfo).port);
    });
  });
}

describe('findFreePort', () => {
  it('skips a busy port', async (t) => {
    const busy = await occupy(t);
    assert.notEqual(await findFreePort(busy), busy);
  });

  it('gives up when nothing is free', async (t) => {
    const busy = await occupy(t);
    await assert.rejects(findFreePort(busy, 1), ServerError);
  });
});

describe('ServerController', () => {
  it('ignores and clears stale state', async (t) => {
    const settings = tempSettings(t);
    const { stateFile } = layout(settings);
    fs.writeFileSync(stateFile, JSON.stringify({ pid: 999_999, port: 9 }));
    assert.equal((await new ServerController(settings).status()).running, false);
    assert.ok(!fs.existsSync(stateFile));
  });

  it('does not trust state that points at some other service', async (t) => {
    const settings = tempSettings(t);
    const foreignPort = await occupy(t); // listening, but not Eazy-share
    fs.writeFileSync(layout(settings).stateFile, JSON.stringify({ pid: process.pid, port: foreignPort }));
    assert.equal((await new ServerController(settings).status()).running, false);
  });

  it('picks another port when the requested one is taken, and stops cleanly', async (t) => {
    const settings = tempSettings(t);
    const taken = await occupy(t);
    const controller = new ServerController(settings);
    const status = await controller.start(taken);
    try {
      assert.ok(status.running);
      assert.notEqual(status.port, taken);
      assert.ok(status.lanUrls.every((url) => url.endsWith(`:${status.port}`)));
    } finally {
      await controller.stop();
    }
    assert.equal((await controller.status()).running, false);
  });

  it('stopping when nothing runs is harmless', async (t) => {
    assert.equal((await new ServerController(tempSettings(t)).stop()).running, false);
  });
});
