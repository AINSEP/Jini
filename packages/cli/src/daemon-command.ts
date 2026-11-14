/**
 * @module daemon-command
 *
 * `daemon status` / `daemon stop` — concrete commands over `@jini-ai/http-kit`'s
 * `daemonStatusRoute`/`daemonShutdownRoute` (`packages/daemon/src/http/daemon-status.ts`).
 * `packages/cli/archived provenance ledger`'s original UNCLEAR verdict on these two
 * blocked on `@jini-ai/http-kit` being a stub with no `/status`/`/shutdown` route to
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
import { exitWithStructuredError } from './errors.js';
import { getJsonFromDaemon, postJsonToDaemon } from './http.js';
import { renderUsage } from './usage.js';
import type { CommandRegistry } from './command-registry.js';
import { defaultWrite, errorOptions, transportOptions, type DaemonCallDeps } from './daemon-call-deps.js';

export interface DaemonCommandDeps extends DaemonCallDeps {}

const DAEMON_STATUS_USAGE = renderUsage({ usage: ['daemon status'] }, { description: 'Reports the running daemon\'s version/host/port/dataDir/shutdown state.' });

const DAEMON_STOP_USAGE = renderUsage({ usage: ['daemon stop'] }, { description: 'Schedules a graceful daemon shutdown. Responds once the shutdown is scheduled, not once the process has actually exited.' });

const DAEMON_USAGE = renderUsage({ usage: ['daemon <status|stop> ...'] }, { description: 'Inspect or control a running Jini daemon over HTTP.' });

function invalidFlag(deps: DaemonCommandDeps, message: string): never {
  return exitWithStructuredError({ code: 'invalid-flag', message }, errorOptions({ deps }));
}

function printJsonResult(deps: DaemonCommandDeps, value: unknown): void {
  (deps.write ?? defaultWrite)({ text: `${JSON.stringify(value)}\n` });
}

/** `daemon status` */
export async function daemonStatusCommand({ args, resolveBaseUrl }: { args: readonly string[]; resolveBaseUrl: DaemonCommandDeps["resolveBaseUrl"] }, optionalArgs: Omit<DaemonCommandDeps, "resolveBaseUrl"> = {}): Promise<void> {
  const deps: DaemonCommandDeps = { resolveBaseUrl, ...optionalArgs };
  if (args.includes('--help') || args.includes('-h')) {
    (deps.write ?? defaultWrite)({ text: `${DAEMON_STATUS_USAGE}\n` });
    return;
  }
  const baseUrl = await deps.resolveBaseUrl();
  const result = await getJsonFromDaemon({ base: baseUrl, route: '/api/daemon/status' }, transportOptions({ deps }));
  printJsonResult(deps, result);
}

/** `daemon stop` */
export async function daemonStopCommand({ args, resolveBaseUrl }: { args: readonly string[]; resolveBaseUrl: DaemonCommandDeps["resolveBaseUrl"] }, optionalArgs: Omit<DaemonCommandDeps, "resolveBaseUrl"> = {}): Promise<void> {
  const deps: DaemonCommandDeps = { resolveBaseUrl, ...optionalArgs };
  if (args.includes('--help') || args.includes('-h')) {
    (deps.write ?? defaultWrite)({ text: `${DAEMON_STOP_USAGE}\n` });
    return;
  }
  const baseUrl = await deps.resolveBaseUrl();
  const result = await postJsonToDaemon({ base: baseUrl, route: '/api/daemon/shutdown', body: {} }, transportOptions({ deps }));
  printJsonResult(deps, result);
}

/** Registers `daemon` (dispatching `status`/`stop` on the first remaining token) against `registry`. */
export function registerDaemonCommands({ registry, resolveBaseUrl }: { registry: CommandRegistry; resolveBaseUrl: DaemonCommandDeps["resolveBaseUrl"] }, optionalArgs: Omit<DaemonCommandDeps, "resolveBaseUrl"> = {}): void {
  const deps: DaemonCommandDeps = { resolveBaseUrl, ...optionalArgs };
  registry.add({ name: 'daemon', handler: async ({ args }) => {
      const [sub, ...rest] = args;
      switch (sub) {
        case 'status':
          return daemonStatusCommand({ args: rest, resolveBaseUrl: resolveBaseUrl }, optionalArgs);
        case 'stop':
          return daemonStopCommand({ args: rest, resolveBaseUrl: resolveBaseUrl }, optionalArgs);
        case undefined:
        case '--help':
        case '-h':
          (deps.write ?? defaultWrite)({ text: `${DAEMON_USAGE}\n` });
          return undefined;
        default:
          return invalidFlag(deps, `unknown "daemon" subcommand: ${sub}`);
      }
    } }, { usage: DAEMON_USAGE });
}
