/**
 * @module daemon-command
 *
 * `daemon status` / `daemon stop` — concrete commands over `@injini/http`'s
 * `daemonStatusRoute`/`daemonShutdownRoute` (`packages/http/src/daemon-status.ts`).
 * `packages/cli/source-map.md`'s original UNCLEAR verdict on these two
 * blocked on `@injini/http` being a stub with no `/status`/`/shutdown` route to
 * call; that blocker no longer holds (both routes exist and are tested), and
 * `run-command.ts` is now a real, established "first concrete command"
 * precedent this file follows rather than pioneers.
 *
 * `daemon status` is a plain read (`GET`, no `requireSameOrigin`).
 * `daemon stop` posts to a `requireSameOrigin: true` route — a bare CLI
 * `fetch()` sends no `Origin` header, so `guardSameOrigin` falls through to
 * its Host-header check (`isLocalSameOrigin`'s `origin == null` branch),
 * which passes as long as the resolved daemon URL's host:port is one the
 * daemon itself considers local. No special headers are added here for
 * that — it is the same call shape `run-command.ts` already uses.
 */
import { exitWithStructuredError, type ExitCodeTable } from './errors.js';
import { getJsonFromDaemon, postJsonToDaemon } from './http.js';
import { renderUsage } from './usage.js';
import type { CommandRegistry } from './command-registry.js';

export interface DaemonCommandDeps {
  /** Resolves the daemon HTTP base URL once per command invocation (e.g. wraps `resolveDaemonUrl`). */
  resolveBaseUrl: () => Promise<string> | string;
  /** Defaults to `process.stdout.write`; inject for tests. Used for successful command output. */
  write?: (text: string) => void;
  /** Defaults to `process.stderr.write`; inject for tests. Used for usage/validation errors. */
  writeErr?: (text: string) => void;
  /** Defaults to the global `fetch`; inject for tests. */
  fetchImpl?: typeof fetch;
  /** Defaults to `process.exit`; inject for tests (must not return). */
  exit?: (code: number) => never;
  /** Extra/overriding `code -> exitCode` entries layered on the package default table. */
  exitCodes?: ExitCodeTable;
}

function defaultWrite(text: string): void {
  process.stdout.write(text);
}

function defaultWriteErr(text: string): void {
  process.stderr.write(text);
}

const DAEMON_STATUS_USAGE = renderUsage({
  usage: ['daemon status'],
  description: 'Reports the running daemon\'s version/host/port/dataDir/shutdown state.',
});

const DAEMON_STOP_USAGE = renderUsage({
  usage: ['daemon stop'],
  description: 'Schedules a graceful daemon shutdown. Responds once the shutdown is scheduled, not once the process has actually exited.',
});

const DAEMON_USAGE = renderUsage({
  usage: ['daemon <status|stop> ...'],
  description: 'Inspect or control a running Jini daemon over HTTP.',
});

/** Builds `{write, exit, exitCodes?}` for `errors.ts`'s structured-error helpers, never assigning `exitCodes` when unset (required under `exactOptionalPropertyTypes`). */
function errorOptions(deps: DaemonCommandDeps): { write: (text: string) => void; exit: (code: number) => never; exitCodes?: ExitCodeTable } {
  return {
    write: deps.writeErr ?? defaultWriteErr,
    exit: deps.exit ?? ((code: number) => process.exit(code)),
    ...(deps.exitCodes !== undefined ? { exitCodes: deps.exitCodes } : {}),
  };
}

/** Builds the transport-call options object for `postJsonToDaemon`/`getJsonFromDaemon`, only ever including a key when its value is actually set. */
function transportOptions(deps: DaemonCommandDeps): {
  fetchImpl?: typeof fetch;
  write?: (text: string) => void;
  exit?: (code: number) => never;
  exitCodes?: ExitCodeTable;
} {
  return {
    ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.writeErr !== undefined ? { write: deps.writeErr } : {}),
    ...(deps.exit !== undefined ? { exit: deps.exit } : {}),
    ...(deps.exitCodes !== undefined ? { exitCodes: deps.exitCodes } : {}),
  };
}

function invalidFlag(deps: DaemonCommandDeps, message: string): never {
  return exitWithStructuredError({ code: 'invalid-flag', message }, errorOptions(deps));
}

function printJsonResult(deps: DaemonCommandDeps, value: unknown): void {
  (deps.write ?? defaultWrite)(`${JSON.stringify(value)}\n`);
}

/** `daemon status` */
export async function daemonStatusCommand(args: readonly string[], deps: DaemonCommandDeps): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    (deps.write ?? defaultWrite)(`${DAEMON_STATUS_USAGE}\n`);
    return;
  }
  const baseUrl = await deps.resolveBaseUrl();
  const result = await getJsonFromDaemon(baseUrl, '/api/daemon/status', transportOptions(deps));
  printJsonResult(deps, result);
}

/** `daemon stop` */
export async function daemonStopCommand(args: readonly string[], deps: DaemonCommandDeps): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    (deps.write ?? defaultWrite)(`${DAEMON_STOP_USAGE}\n`);
    return;
  }
  const baseUrl = await deps.resolveBaseUrl();
  const result = await postJsonToDaemon(baseUrl, '/api/daemon/shutdown', {}, transportOptions(deps));
  printJsonResult(deps, result);
}

/** Registers `daemon` (dispatching `status`/`stop` on the first remaining token) against `registry`. */
export function registerDaemonCommands(registry: CommandRegistry, deps: DaemonCommandDeps): void {
  registry.add(
    'daemon',
    async (args) => {
      const [sub, ...rest] = args;
      switch (sub) {
        case 'status':
          return daemonStatusCommand(rest, deps);
        case 'stop':
          return daemonStopCommand(rest, deps);
        case undefined:
        case '--help':
        case '-h':
          (deps.write ?? defaultWrite)(`${DAEMON_USAGE}\n`);
          return;
        default:
          invalidFlag(deps, `unknown "daemon" subcommand: ${sub}`);
      }
    },
    { usage: DAEMON_USAGE },
  );
}
