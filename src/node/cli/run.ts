// Argument parsing and dispatch. Kept separate from main.ts so it can be imported by tests.
import { parseArgs } from 'node:util';
import { DEFAULT_PORT, VERSION } from '../core/config.js';
import { BROWSERS, type Browser } from '../native/installer.js';
import * as commands from './commands.js';

const HELP = `eazy-share ${VERSION}: share files with devices on your network.

Usage: eazy-share [--home DIR] <command> [options]

Commands:
  serve            run the server in the foreground (--host, --port; default port ${DEFAULT_PORT})
  start            start the server in the background (--port, --json)
  stop             stop the background server (--json)
  status           show whether the server is running (--json)
  install-host     register the native host so the extension can start the server
                   (--browser chrome|chromium|brave|edge, repeatable; --dest DIR)
  uninstall-host   remove that registration (--dest DIR)
  native-host      (used by the browser) native messaging host
`;

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

export async function run(argv: string[]): Promise<number> {
  // strict: false, because Chrome appends the calling origin to the host's command line.
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      home: { type: 'string' },
      host: { type: 'string' },
      port: { type: 'string' },
      json: { type: 'boolean' },
      browser: { type: 'string', multiple: true },
      dest: { type: 'string' },
      'extension-id': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
    },
  });

  if (values.version) {
    console.log(VERSION);
    return 0;
  }
  const command = positionals[0];
  if (values.help || !command) {
    console.log(HELP);
    return command || values.help ? 0 : 1;
  }

  const rawPort = str(values.port);
  const port = rawPort === undefined ? undefined : Number(rawPort);
  if (port !== undefined && !(Number.isInteger(port) && port >= 0 && port <= 65535)) {
    console.error(`Error: invalid port "${rawPort}"`);
    return 1;
  }
  const browsers = (Array.isArray(values.browser) ? values.browser : []).map(String);
  const invalid = browsers.filter((b) => !(BROWSERS as readonly string[]).includes(b));
  if (invalid.length) {
    console.error(`Error: unknown browser "${invalid[0]}". Choose from: ${BROWSERS.join(', ')}.`);
    return 1;
  }

  const options: commands.Options = {
    json: values.json === true,
    browsers: browsers as Browser[],
    ...(str(values.home) !== undefined && { home: str(values.home) as string }),
    ...(str(values.host) !== undefined && { host: str(values.host) as string }),
    ...(port !== undefined && { port }),
    ...(str(values.dest) !== undefined && { dest: str(values.dest) as string }),
    ...(str(values['extension-id']) !== undefined && { extensionId: str(values['extension-id']) as string }),
  };

  switch (command) {
    case 'serve':
      return commands.serve(options);
    case 'start':
      return commands.start(options);
    case 'stop':
      return commands.stop(options);
    case 'status':
      return commands.status(options);
    case 'native-host':
      return commands.nativeHost(options);
    case 'install-host':
      return commands.installHost(options);
    case 'uninstall-host':
      return commands.uninstallHost(options);
    default:
      console.error(`Unknown command: ${command}\n\n${HELP}`);
      return 1;
  }
}
