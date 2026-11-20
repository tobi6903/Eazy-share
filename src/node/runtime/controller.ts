// Runs the Eazy-share server as a detached background process and tracks it in a state file.
//
// The native-messaging host exits right after answering the browser, so the server has to
// outlive it: it is started detached, with its output going to a log file.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import type { HealthResponse, ServerStatus } from '../../shared/api.js';
import { APP_NAME, CLI_ENTRY, layout, type Settings } from '../core/config.js';
import { urlsFor } from '../core/netinfo.js';

const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 5_000;
const PORT_ATTEMPTS = 20;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Raised when the server can't be started or stopped; the message is shown to the user. */
export class ServerError extends Error {}

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '0.0.0.0', () => probe.close(() => resolve(true)));
  });
}

/** First port >= preferred that nobody is listening on. */
export async function findFreePort(preferred: number, attempts = PORT_ATTEMPTS): Promise<number> {
  for (let port = preferred; port < preferred + attempts; port++) {
    if (await canBind(port)) return port;
  }
  throw new ServerError(`No free port found between ${preferred} and ${preferred + attempts - 1}.`);
}

/** True if an Eazy-share server answers on this port. */
export async function isEazyShare(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    const body = (await response.json()) as Partial<HealthResponse>;
    return body.app === APP_NAME;
  } catch {
    return false;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'; // exists, but isn't ours to signal
  }
}

interface State {
  pid: number;
  port: number;
}

export class ServerController {
  private readonly files: ReturnType<typeof layout>;

  constructor(private readonly settings: Settings) {
    this.files = layout(settings);
  }

  // --- state file ------------------------------------------------------------

  private readState(): State | undefined {
    try {
      const state = JSON.parse(fs.readFileSync(this.files.stateFile, 'utf8')) as Partial<State>;
      return typeof state.pid === 'number' && typeof state.port === 'number' ? { pid: state.pid, port: state.port } : undefined;
    } catch {
      return undefined;
    }
  }

  private writeState(state: State): void {
    fs.mkdirSync(this.settings.home, { recursive: true });
    fs.writeFileSync(this.files.stateFile, JSON.stringify({ ...state, started: Date.now() }));
  }

  private clearState(): void {
    fs.rmSync(this.files.stateFile, { force: true });
  }

  // --- public API ------------------------------------------------------------

  async status(): Promise<ServerStatus> {
    const state = this.readState();
    if (state) {
      if (pidAlive(state.pid) && (await isEazyShare(state.port))) return running(state.pid, state.port);
      this.clearState(); // stale: process died, or the port now belongs to something else
    }
    return notRunning();
  }

  async start(port?: number): Promise<ServerStatus> {
    const current = await this.status();
    if (current.running) return current;

    const chosen = await findFreePort(port ?? this.settings.port);
    fs.mkdirSync(this.settings.home, { recursive: true });
    const log = fs.openSync(this.files.logFile, 'a');
    const child = spawn(
      process.execPath,
      [CLI_ENTRY, '--home', this.settings.home, 'serve', '--host', this.settings.host, '--port', String(chosen)],
      {
        detached: true,
        windowsHide: true, // no console window flashing up on Windows
        stdio: ['ignore', log, log],
        env: { ...process.env, EAZY_SHARE_HOME: this.settings.home },
      },
    );
    fs.closeSync(log);
    child.unref(); // survive the native host (and the browser) exiting

    let exited = false;
    child.once('exit', () => (exited = true));
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (exited) throw new ServerError(`The server exited immediately. Last log lines:\n${this.logTail()}`);
      if (child.pid !== undefined && (await isEazyShare(chosen))) {
        this.writeState({ pid: child.pid, port: chosen });
        return running(child.pid, chosen);
      }
      await sleep(100);
    }
    child.kill();
    throw new ServerError(`The server did not start within ${START_TIMEOUT_MS / 1000}s. Last log lines:\n${this.logTail()}`);
  }

  async stop(): Promise<ServerStatus> {
    const current = await this.status();
    if (!current.running || current.pid === null) return notRunning();

    process.kill(current.pid, 'SIGTERM');
    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while (Date.now() < deadline && pidAlive(current.pid)) await sleep(100);
    if (pidAlive(current.pid)) process.kill(current.pid, 'SIGKILL');
    this.clearState();
    return notRunning();
  }

  private logTail(lines = 10): string {
    try {
      return fs.readFileSync(this.files.logFile, 'utf8').split('\n').slice(-lines).join('\n');
    } catch {
      return '(no log)';
    }
  }
}

const notRunning = (): ServerStatus => ({ running: false, pid: null, port: null, localUrl: null, lanUrls: [] });

const running = (pid: number, port: number): ServerStatus => ({
  running: true,
  pid,
  port,
  localUrl: `http://localhost:${port}`,
  lanUrls: urlsFor(port),
});
