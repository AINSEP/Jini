/**
 * @module version-command
 *
 * `version` — prints just the running daemon's version string. Sourced from
 * `GET /api/daemon/status`'s `version` field (`packages/daemon/src/http/daemon-status.ts`,
 * `DaemonStatusResponse.version`) — the same route `daemon-command.ts`'s `daemon status`
 * already calls. `070311a07^:packages/cli/source-map.md`'s original UNCLEAR verdict on a standalone
 * `version` command noted "@jini-ai/http-kit has no version route yet ... nothing to call"; that
 * blocker never actually required a *separate* route — `daemonStatusRoute`'s response body
 * already carries a `version` field, so no new HTTP route was added for this command. It just
 * extracts and prints that one field instead of the full status envelope `daemon status` prints.
 *
 * Same DI/testing/`resolveBaseUrl` conventions as `daemon-command.ts`'s `daemon status`/`daemon
 * stop`; this file shares `daemon-call-deps.ts` with the other daemon commands.
 */
import { exitWithStructuredError } from './errors.js';
import { getJsonFromDaemon } from './http.js';
import { renderUsage } from './usage.js';
import type { CommandRegistry } from './command-registry.js';
import { defaultWrite, errorOptions, transportOptions, type DaemonCallDeps } from './daemon-call-deps.js';

export interface VersionCommandDeps extends DaemonCallDeps {}

const VERSION_USAGE = renderUsage({ usage: ['version'] }, { description: 'Prints the running daemon\'s version string (nothing else — see "daemon status" for the full status envelope).' });

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
  return exitWithStructuredError({ code: 'daemon-not-running', message: '/api/daemon/status response did not include a version string' }, errorOptions({ deps }));
}

/** `version` */
export async function versionCommand({ args, resolveBaseUrl }: { args: readonly string[]; resolveBaseUrl: VersionCommandDeps["resolveBaseUrl"] }, optionalArgs: Omit<VersionCommandDeps, "resolveBaseUrl"> = {}): Promise<void> {
  const deps: VersionCommandDeps = { resolveBaseUrl, ...optionalArgs };
  if (args.includes('--help') || args.includes('-h')) {
    (deps.write ?? defaultWrite)({ text: `${VERSION_USAGE}\n` });
    return;
  }
  const baseUrl = await deps.resolveBaseUrl();
  const result = await getJsonFromDaemon({ base: baseUrl, route: '/api/daemon/status' }, transportOptions({ deps }));
  const version = extractVersion(deps, result);
  (deps.write ?? defaultWrite)({ text: `${version}\n` });
}

/** Registers `version` against `registry`. */
export function registerVersionCommand({ registry, resolveBaseUrl }: { registry: CommandRegistry; resolveBaseUrl: VersionCommandDeps["resolveBaseUrl"] }, optionalArgs: Omit<VersionCommandDeps, "resolveBaseUrl"> = {}): void {
  registry.add({ name: 'version', handler: ({ args }) => versionCommand({ args, resolveBaseUrl }, optionalArgs) }, { usage: VERSION_USAGE });
}
