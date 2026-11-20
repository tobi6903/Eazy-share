import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import { EXTENSION_ID, layout, NATIVE_HOST_NAME, PROJECT_ROOT, VERSION } from '../core/config.js';
import { tempSettings } from '../testing/helpers.js';
import {
  browserInfo,
  install,
  InstallError,
  launcherName,
  uninstall,
  type HostManifest,
  type Registry,
} from './installer.js';
import { encodeMessage, readMessages } from './protocol.js';

const readManifest = (file: string): HostManifest => JSON.parse(fs.readFileSync(file, 'utf8')) as HostManifest;

/** A stand-in for the Windows registry that just remembers what was written. */
class FakeRegistry implements Registry {
  keys = new Map<string, string>();
  set(key: string, value: string): void {
    this.keys.set(key, value);
  }
  remove(key: string): void {
    if (!this.keys.delete(key)) throw new Error('key not found');
  }
}

describe('installer (this OS)', () => {
  it('writes an executable launcher and a manifest that points at it', (t) => {
    const settings = tempSettings(t);
    const dest = path.join(settings.home, 'NativeMessagingHosts');
    const { files } = install(settings, { dest });
    assert.deepEqual(files, [path.join(dest, `${NATIVE_HOST_NAME}.json`)]);

    const manifest = readManifest(files[0] as string);
    const launcher = path.join(layout(settings).binDir, launcherName());
    assert.equal(manifest.name, NATIVE_HOST_NAME);
    assert.equal(manifest.type, 'stdio');
    assert.equal(manifest.path, launcher);
    assert.ok(path.isAbsolute(manifest.path), 'Chrome requires an absolute path');
    assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${EXTENSION_ID}/`]);
    if (process.platform !== 'win32') assert.ok(fs.statSync(launcher).mode & 0o100, 'launcher is executable');
  });

  it("uses an extension id that matches the extension's manifest key", () => {
    // If these drift apart, Chrome refuses to let the extension use the host.
    const manifest = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'extension', 'manifest.json'), 'utf8')) as { key: string };
    const digest = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
    const derived = [...digest].map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))).join('');
    assert.equal(derived, EXTENSION_ID);
  });

  it('rejects unknown browsers', (t) => {
    assert.throws(() => install(tempSettings(t), { browsers: ['netscape' as 'chrome'] }), InstallError);
  });

  it('uninstall removes what install wrote', (t) => {
    const settings = tempSettings(t);
    const dest = path.join(settings.home, 'NativeMessagingHosts');
    install(settings, { dest });
    assert.equal(uninstall(settings, { dest }).files.length, 1);
    assert.ok(!fs.existsSync(path.join(dest, `${NATIVE_HOST_NAME}.json`)));
    assert.ok(!fs.existsSync(path.join(layout(settings).binDir, launcherName())));
  });
});

describe('installer (Windows, simulated)', () => {
  const setup = (t: Parameters<typeof tempSettings>[0]) => {
    const settings = tempSettings(t);
    const localAppData = path.join(settings.home, 'AppData', 'Local');
    const env = { LOCALAPPDATA: localAppData };
    // Pretend Chrome and Edge are installed; Brave and Chromium are not.
    for (const browser of ['chrome', 'edge'] as const) {
      fs.mkdirSync(browserInfo('win32', env)[browser].userDataDir, { recursive: true });
    }
    return { settings, env, registry: new FakeRegistry() };
  };

  it('writes a .cmd launcher and one manifest, and registers every installed browser', (t) => {
    const { settings, env, registry } = setup(t);
    const result = install(settings, { platform: 'win32', env, registry });

    const manifestFile = path.join(settings.home, 'native', `${NATIVE_HOST_NAME}.json`);
    assert.deepEqual(result.files, [manifestFile]);
    assert.deepEqual(
      [...registry.keys.keys()].sort(),
      [
        `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
        `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
      ].sort(),
    );
    assert.ok([...registry.keys.values()].every((value) => value === manifestFile), 'every key points at the manifest');

    const launcher = readManifest(manifestFile).path;
    assert.ok(launcher.endsWith('eazy-share-host.cmd'));
    const script = fs.readFileSync(launcher, 'utf8');
    assert.match(script, /^@echo off\r\n/);
    assert.match(script, /native-host\r\n$/);
    assert.ok(script.includes(`"${process.execPath}"`), 'node is quoted so paths with spaces work');
  });

  it('escapes percent signs in paths for cmd.exe', (t) => {
    const { settings, env, registry } = setup(t);
    const odd = { ...settings, home: `${settings.home}${path.sep}50%off` };
    fs.mkdirSync(path.join(odd.home), { recursive: true });
    install(odd, { platform: 'win32', env, registry });
    const script = fs.readFileSync(path.join(odd.home, 'bin', 'eazy-share-host.cmd'), 'utf8');
    assert.ok(script.includes('50%%off'));
  });

  it('only registers the browsers you ask for', (t) => {
    const { settings, env, registry } = setup(t);
    const result = install(settings, { platform: 'win32', env, registry, browsers: ['edge'] });
    assert.equal(result.registryKeys.length, 1);
    assert.match(result.registryKeys[0] as string, /Edge/);
  });

  it('fails clearly when no browser is installed', (t) => {
    const settings = tempSettings(t);
    const env = { LOCALAPPDATA: path.join(settings.home, 'empty') };
    assert.throws(() => install(settings, { platform: 'win32', env, registry: new FakeRegistry() }), /No supported browser/);
  });

  it('uninstall removes the registry keys, the manifest and the launcher', (t) => {
    const { settings, env, registry } = setup(t);
    install(settings, { platform: 'win32', env, registry });
    const removed = uninstall(settings, { platform: 'win32', env, registry });
    assert.equal(registry.keys.size, 0);
    assert.equal(removed.registryKeys.length, 2, 'keys that did not exist are skipped quietly');
    assert.ok(!fs.existsSync(path.join(settings.home, 'native', `${NATIVE_HOST_NAME}.json`)));
    assert.ok(!fs.existsSync(path.join(settings.home, 'bin', 'eazy-share-host.cmd')));
  });
});

describe('launcher (run the way Chrome runs it: one process per message)', () => {
  const ask = async (launcher: string, request: object): Promise<Record<string, unknown>> => {
    const result = spawnSync(launcher, [`chrome-extension://${EXTENSION_ID}/`], {
      input: encodeMessage(request),
      timeout: 30_000,
      shell: process.platform === 'win32', // .cmd files need a shell on Windows
    });
    assert.equal(result.status, 0, result.stderr.toString());
    for await (const reply of readMessages(Readable.from([result.stdout]))) return reply;
    throw new Error('no reply');
  };

  it('ping, start, status, start again, stop', async (t) => {
    const settings = tempSettings(t);
    install(settings, { dest: path.join(settings.home, 'NativeMessagingHosts') });
    const launcher = path.join(layout(settings).binDir, launcherName());

    assert.deepEqual(await ask(launcher, { command: 'ping' }), { ok: true, version: VERSION });
    assert.equal((await ask(launcher, { command: 'status' }))['running'], false);

    const started = await ask(launcher, { command: 'start' });
    try {
      assert.equal(started['ok'], true, JSON.stringify(started));
      assert.equal(started['running'], true);
      assert.match(String(started['localUrl']), /^http:\/\/localhost:\d+$/);
      // The server outlived the host process that started it.
      assert.equal((await ask(launcher, { command: 'status' }))['running'], true);
      // Starting again is idempotent.
      assert.equal((await ask(launcher, { command: 'start' }))['pid'], started['pid']);
    } finally {
      const stopped = await ask(launcher, { command: 'stop' });
      assert.equal(stopped['running'], false);
    }
    assert.equal((await ask(launcher, { command: 'status' }))['running'], false);
  });
});
