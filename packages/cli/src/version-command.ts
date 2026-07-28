/**
 * @module version-command
 *
 * `version` — prints just the running daemon's version string. Sourced from
 * `GET /api/daemon/status`'s `version` field (`packages/http/src/daemon-status.ts`,
 * `DaemonStatusResponse.version`) — the same route `daemon-command.ts`'s `daemon status`
 * already calls. `packages/cli/source-map.md`'s original UNCLEAR verdict on a standalone
 * `version` command noted "@injini/http has no version route yet ... nothing to call"; that
 * blocker never actually required a *separate* route — `daemonStatusRoute`'s response body
 * already carries a `version` field, so no new HTTP route was added for this command. It just
 * extracts and prints that one field instead of the full status envelope `daemon status` prints.
 *
 * Same DI/testing/`resolveBaseUrl` conventions as `daemon-command.ts`'s `daemon status`/`daemon
 * stop` (this file duplicates rather than imports their small `errorOptions`/`transportOptions`
 * helpers, matching that file's own precedent of each command module owning its own copy rather
 * than sharing a not-otherwise-needed abstraction across files).
 */
import { exitWithStructuredError, type ExitCodeTable } from './errors.js';
import { getJsonFromDaemon } from './http.js';
import { renderUsage } from './usage.js';
import type { CommandRegistry } from './command-registry.js';

export interface VersionCommandDeps {
  /** Resolves the daemon HTTP base URL once per command invocation (e.g. wraps `resolveDaemonUrl`). */
  resolveBaseUrl: () => Promise<string> | string;
  /** Defaults to `process.stdout.write`; inject for tests. Used for the printed version string. */
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

const VERSION_USAGE = renderUsage({
  usage: ['version'],
  description: 'Prints the running daemon\'s version string (nothing else — see "daemon status" for the full status envelope).',
});

/** Builds `{write, exit, exitCodes?}` for `errors.ts`'s structured-error helpers, never assigning `exitCodes` when unset (required under `exactOptionalPropertyTypes`). */
function errorOptions(deps: VersionCommandDeps): { write: (text: string) => void; exit: (code: number) => never; exitCodes?: ExitCodeTable } {
  return {
    write: deps.writeErr ?? defaultWriteErr,
    exit: deps.exit ?? ((code: number) => process.exit(code)),
    ...(deps.exitCodes !== undefined ? { exitCodes: deps.exitCodes } : {}),
  };
}

/** Builds the transport-call options object for `getJsonFromDaemon`, only ever including a key when its value is actually set. */
function transportOptions(deps: VersionCommandDeps): {
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

/**
 * Extracts a non-empty `version` string out of `/api/daemon/status`'s parsed JSON body. A daemon
 * that responds 2xx but omits (or mistypes) `version` is exactly as "not behaving like a Jini
 * daemon" as an unreachable one — this reuses the `daemon-not-running` code (the same fallback
 * `structuredHttpFailure` itself defaults to elsewhere in this package) rather than inventing a
 * new exit code for this one caller.
 */
function extractVersion(deps: VersionCommandDeps, body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const version = (body as { version?: unknown }).version;
    if (typeof version === 'string' && version.length > 0) return version;
  }
  return exitWithStructuredError(
    { code: 'daemon-not-running', message: '/api/daemon/status response did not include a version string' },
    errorOptions(deps),
  );
}

/** `version` */
export async function versionCommand(args: readonly string[], deps: VersionCommandDeps): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    (deps.write ?? defaultWrite)(`${VERSION_USAGE}\n`);
    return;
  }
  const baseUrl = await deps.resolveBaseUrl();
  const result = await getJsonFromDaemon(baseUrl, '/api/daemon/status', transportOptions(deps));
  const version = extractVersion(deps, result);
  (deps.write ?? defaultWrite)(`${version}\n`);
}

/** Registers `version` against `registry`. */
export function registerVersionCommand(registry: CommandRegistry, deps: VersionCommandDeps): void {
  registry.add('version', (args) => versionCommand(args, deps), { usage: VERSION_USAGE });
}
