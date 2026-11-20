// The command implementations behind `eazy-share <command>`.
import type { ServerStatus } from '../../shared/api.js';
import { EazyShareApp } from '../core/app.js';
import { createSettings, VERSION, type Settings } from '../core/config.js';
import { urlsFor } from '../core/netinfo.js';
import { close, createHttpServer, listen } from '../http/server.js';
import * as host from '../native/host.js';
import * as installer from '../native/installer.js';
import { ServerController, ServerError } from '../runtime/controller.js';

export interface Options {
  home?: string;
  host?: string;
  port?: number;
  json: boolean;
  browsers: installer.Browser[];
  dest?: string;
  extensionId?: string;
}

export function settingsFrom(options: Options): Settings {
  return createSettings({
    ...(options.home !== undefined && { home: options.home }),
    ...(options.host !== undefined && { host: options.host }),
    ...(options.port !== undefined && { port: options.port }),
  });
}

/** Run the server in the foreground until SIGINT/SIGTERM. */
export async function serve(options: Options): Promise<number> {
  const settings = settingsFrom(options);
  const app = new EazyShareApp(settings);
  const server = createHttpServer(app);

  let port: number;
  try {
    port = await listen(server, settings.host, settings.port);
  } catch (error) {
    console.error(`Error: could not listen on port ${settings.port}: ${(error as Error).message}`);
    return 1;
  }
  app.startBackgroundTasks();

  console.log(`\n  Eazy-share ${VERSION} is running\n`);
  console.log(`  This computer  : http://localhost:${port}`);
  for (const url of urlsFor(port)) console.log(`  On your network: ${url}`);
  console.log(`  Temporary files: ${settings.home}\n`);

  // `stop` sends SIGTERM: shut down cleanly.
  await new Promise<void>((resolve) => {
    process.once('SIGTERM', resolve);
    process.once('SIGINT', resolve);
  });
  app.stopBackgroundTasks();
  await close(server);
  return 0;
}

function printStatus(status: ServerStatus, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(status));
  } else if (status.running) {
    console.log(`Running (pid ${status.pid})\n  This computer  : ${status.localUrl}`);
    for (const url of status.lanUrls) console.log(`  On your network: ${url}`);
  } else {
    console.log('Not running');
  }
}

export async function start(options: Options): Promise<number> {
  try {
    printStatus(await new ServerController(settingsFrom(options)).start(options.port), options.json);
    return 0;
  } catch (error) {
    if (!(error instanceof ServerError)) throw error;
    console.error(`Error: ${error.message}`);
    return 1;
  }
}

export async function stop(options: Options): Promise<number> {
  printStatus(await new ServerController(settingsFrom(options)).stop(), options.json);
  return 0;
}

export async function status(options: Options): Promise<number> {
  printStatus(await new ServerController(settingsFrom(options)).status(), options.json);
  return 0;
}

/** Used by the browser: speaks the native-messaging protocol on stdin/stdout. */
export async function nativeHost(options: Options): Promise<number> {
  await host.run(process.stdin, process.stdout, new ServerController(settingsFrom(options)));
  return 0;
}

export function installHost(options: Options): number {
  try {
    const { files, registryKeys } = installer.install(settingsFrom(options), {
      ...(options.browsers.length > 0 && { browsers: options.browsers }),
      ...(options.dest !== undefined && { dest: options.dest }),
      ...(options.extensionId !== undefined && { extensionId: options.extensionId }),
    });
    console.log('Native host installed:');
    for (const file of files) console.log(`  ${file}`);
    for (const key of registryKeys) console.log(`  ${key}`);
    console.log('\nNext: load the `dist/extension` folder in your browser (chrome://extensions > Developer mode > Load unpacked).');
    return 0;
  } catch (error) {
    if (!(error instanceof installer.InstallError)) throw error;
    console.error(`Error: ${error.message}`);
    return 1;
  }
}

export function uninstallHost(options: Options): number {
  const { files, registryKeys } = installer.uninstall(settingsFrom(options), options.dest !== undefined ? { dest: options.dest } : {});
  const removed = [...files, ...registryKeys];
  console.log(removed.length ? 'Removed:' : 'Nothing to remove.');
  for (const item of removed) console.log(`  ${item}`);
  return 0;
}
