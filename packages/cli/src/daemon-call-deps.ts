import type { ExitCodeTable } from './errors.js';

export interface DaemonCallDeps {
  /** Resolves the daemon HTTP base URL once per command invocation (e.g. wraps `resolveDaemonUrl`). */
  resolveBaseUrl: () => Promise<string> | string;
  /** Defaults to `process.stdout.write`; inject for tests. Used for successful command output. */
  write?: (requiredArgs: { text: string }) => void;
  /** Defaults to `process.stderr.write`; inject for tests. Used for usage/validation errors. */
  writeErr?: (requiredArgs: { text: string }) => void;
  /** Defaults to the global `fetch`; inject for tests. */
  fetchImpl?: typeof fetch;
  /** Defaults to `process.exit`; inject for tests (must not return). */
  exit?: (requiredArgs: { code: number }) => never;
  /** Extra/overriding `code -> exitCode` entries layered on the package default table. */
  exitCodes?: ExitCodeTable;
}

export function defaultWrite({ text }: { text: string }, _optional: Record<string, never> = {}): void {
  process.stdout.write(text);
}

export function defaultWriteErr({ text }: { text: string }, _optional: Record<string, never> = {}): void {
  process.stderr.write(text);
}

/** Builds `{write, exit, exitCodes?}` for `errors.ts`'s structured-error helpers, never assigning `exitCodes` when unset (required under `exactOptionalPropertyTypes`). */
export function errorOptions({ deps }: { deps: Omit<DaemonCallDeps, 'resolveBaseUrl'> }, _optional: Record<string, never> = {}): { write: (requiredArgs: { text: string }) => void; exit: (requiredArgs: { code: number }) => never; exitCodes?: ExitCodeTable } {
  return {
    write: deps.writeErr ?? defaultWriteErr,
    exit: deps.exit ?? (({ code }: { code: number }) => process.exit(code)),
    ...(deps.exitCodes !== undefined ? { exitCodes: deps.exitCodes } : {}),
  };
}

/** Builds the transport-call options object for `postJsonToDaemon`/`getJsonFromDaemon`, only ever including a key when its value is actually set. */
export function transportOptions({ deps }: { deps: DaemonCallDeps }, _optional: Record<string, never> = {}): {
  fetchImpl?: typeof fetch;
  write?: (requiredArgs: { text: string }) => void;
  exit?: (requiredArgs: { code: number }) => never;
  exitCodes?: ExitCodeTable;
} {
  return {
    ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.writeErr !== undefined ? { write: deps.writeErr } : {}),
    ...(deps.exit !== undefined ? { exit: deps.exit } : {}),
    ...(deps.exitCodes !== undefined ? { exitCodes: deps.exitCodes } : {}),
  };
}
