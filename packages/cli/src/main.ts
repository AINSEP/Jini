#!/usr/bin/env node
/**
 * @module main
 *
 * The bootable `jini` binary (`package.json`'s `"bin": { "jini": "./dist/main.js" }`). Every
 * other module in this package is a library building block — `run-command.ts`,
 * `daemon-command.ts`, and `version-command.ts` each export a `register*Commands(registry,
 * deps)` function ready for a pack to call, but until this file, nothing actually parsed
 * `process.argv` and called them: `packages/cli/source-map.md`'s "Not built" note on
 * `run-command.ts`'s original addition said as much — "no wiring of this file's commands into
 * an actual bootable CLI entrypoint." This closes that gap.
 *
 * Deliberately **not** re-exported from `index.ts`. `index.ts` is this package's library
 * barrel — importing it must be side-effect-free. This file's whole purpose is a
 * process.argv-parsing, stdout/stderr-writing, potentially process.exit-calling side effect;
 * bundling that into the library barrel would mean simply `import`ing `@jini-ai/cli` as a
 * dependency could start acting like a CLI invocation. The guarded top-level block at the
 * bottom of this file (only runs `main()` for real when this module is the actual process
 * entrypoint, not merely imported) exists for the same reason, one level down: importing the
 * named `main` export for testing (or for a consumer that wants to build its own bin wrapper
 * around it) must not itself trigger a real run.
 *
 * **Daemon-URL resolution.** `resolveDaemonUrl` (`daemon-url.ts`) has no baked-in default —
 * this package has never had a locked default daemon port to fall back to (see
 * `source-map.md`: `@jini-ai/node-host`'s `createLocalNodeDaemon` binds an ephemeral port, not a
 * fixed one). This binary wires the three real, already-built pieces together instead of
 * inventing a new one: an explicit `--daemon-url <url>` flag (highest precedence), a
 * `JINI_DAEMON_URL` env var, and — when `--data-dir <path>` or `--registry-path <path>` is
 * given — `local-daemon-discovery.ts`'s `createLocalDaemonDiscovery`, the CLI-side reader for
 * a `@jini-ai/node-host`-written on-disk daemon registry record. That discovery module's own doc
 * already flagged it as built-but-unconsumed ("no pack has registered against
 * `CommandRegistry` yet"); this is that consumer. If none of the three resolve, there is still
 * no silent fallback — `resolveDaemonUrl` throws, and this file's own catch boundary (below)
 * turns that into a clean structured-error exit instead of a raw stack trace.
 *
 * **Global flags are stripped before dispatch, not left for `CommandRegistry`'s `valueFlags`
 * skip-ahead.** `CommandRegistry.dispatch`'s `valueFlags` option (see `command-registry.ts`)
 * correctly *finds* the command-name token when a global flag with a value precedes it (e.g.
 * `--daemon-url http://x run` picks `run`, not the URL) — but the `rest` array it then hands
 * the matched handler still *contains* that leading global flag and its value, ahead of
 * whatever the handler expects as its own first token. That's harmless for a flat command, but
 * `run-command.ts`/`daemon-command.ts`'s own registered handlers immediately do a *second*
 * `const [sub, ...rest] = args` dispatch of their own, assuming `args[0]` is their immediate
 * subcommand (`start`/`status`/etc.) with no tolerance for a stray leading flag — exactly what
 * a global flag ahead of the command name would produce. Rather than change that (well-tested,
 * out-of-scope) nested-dispatch assumption, {@link partitionGlobalArgv} below removes this
 * binary's own three global flags (and their values) from `argv` in a single pass *before*
 * dispatch, so `run`/`daemon`/`version` always land as a clean first token no matter where on
 * the command line `--daemon-url`/`--data-dir`/`--registry-path` were typed.
 *
 * **`--version`/`-v`.** This package's `package.json` is `"private": true` with a placeholder
 * `"0.0.0"` version — not a real, published semver worth printing. Rather than invent one,
 * `jini --version`/`jini -v` (recognized only as the very first token — see {@link main}) is a
 * plain alias for `jini version` (`version-command.ts`): it prints the *running daemon's* real
 * version. That is arguably more useful to a user of this transport-only CLI than this
 * package's own unpublished build number would be, and it means `--version` has exactly one
 * implementation to keep correct, not two.
 *
 * **Error boundary.** `parseFlags` (`flags.ts`) throws a plain `Error` for an unrecognized
 * `--flag` or a string flag with no value — by design (see that module's own doc: "a
 * hallucinated flag from an LLM-driven caller should error immediately"), but every existing
 * command handler (`run-command.ts`, `daemon-command.ts`, `version-command.ts`) calls it
 * un-wrapped, so that throw would otherwise surface as an unhandled rejection with a raw stack
 * trace instead of the clean `{ error: { code, message } }` envelope every *other* failure
 * path in this package produces. {@link main} wraps its dispatch in a boundary that converts
 * any such raw throw into the same structured-error contract. Distinguishing "a raw,
 * unexpected throw" from "a nested command already exited cleanly through
 * `exitWithStructuredError`" (the latter must never be re-wrapped — that would double-report
 * the same failure, or worse, mask the original exit code with a generic one) uses a local
 * flag set by this file's own `exit` wrapper: if the wrapped `exit` was ever invoked before the
 * catch fires, the original error is re-thrown untouched instead of reformatted. In real
 * operation this distinction is moot — `process.exit` never returns, so nothing downstream of
 * a real exit call ever reaches the catch — but it matters for this file's own tests, which
 * (like every other test in this package) inject a throwing `exit` double to make
 * `process.exit`'s real "never returns" behavior observable without ending the test process.
 */
import { fileURLToPath } from 'node:url';
import { CommandRegistry, type CommandDispatchResult } from './command-registry.js';
import { registerDaemonCommands } from './daemon-command.js';
import { resolveDaemonUrl, type ResolveDaemonUrlOptions } from './daemon-url.js';
import { exitWithStructuredError } from './errors.js';
import { createLocalDaemonDiscovery } from './local-daemon-discovery.js';
import { registerRunCommands } from './run-command.js';
import { renderUsage } from './usage.js';
import { registerVersionCommand } from './version-command.js';

export interface MainDeps {
  /** Defaults to `process.stdout.write`; inject for tests. */
  write?: (text: string) => void;
  /** Defaults to `process.stderr.write`; inject for tests. */
  writeErr?: (text: string) => void;
  /** Defaults to `process.exit`; inject for tests (must not return). */
  exit?: (code: number) => never;
  /** Defaults to the global `fetch`; inject for tests. */
  fetchImpl?: typeof fetch;
  /** Defaults to `process.env`; inject for tests. */
  env?: NodeJS.ProcessEnv;
}

function defaultWrite(text: string): void {
  process.stdout.write(text);
}

function defaultWriteErr(text: string): void {
  process.stderr.write(text);
}

/** Name of the environment variable {@link resolveDaemonUrl} checks when `--daemon-url` is absent. */
const DAEMON_URL_ENV_VAR = 'JINI_DAEMON_URL';

const ROOT_USAGE = renderUsage({
  usage: ['jini <command> [...args]'],
  description: 'CLI transport for a Jini daemon over HTTP. Commands: run, daemon, version.',
  options: [
    { flag: '--daemon-url <url>', description: 'Explicit daemon base URL. Takes precedence over JINI_DAEMON_URL and local discovery.' },
    { flag: '--data-dir <path>', description: "Resolve a locally running daemon's URL from this data directory's on-disk registry (see @jini-ai/node-host's createLocalNodeDaemon)." },
    { flag: '--registry-path <path>', description: "Exact registry file path, overriding --data-dir's derived default." },
    { flag: '--help, -h', description: 'Show this help.' },
    { flag: '--version, -v', description: 'Print the running daemon\'s version (alias for "jini version"; recognized only as the first argument).' },
  ],
});

const GLOBAL_FLAG_NAMES = ['daemon-url', 'data-dir', 'registry-path'] as const;
type GlobalFlagName = (typeof GLOBAL_FLAG_NAMES)[number];

interface PartitionedArgv {
  readonly globals: Partial<Record<GlobalFlagName, string>>;
  /** `argv` with every recognized global flag (and its value) removed, original order preserved. */
  readonly rest: string[];
}

/**
 * Single-pass extraction of this binary's own global `--daemon-url`/`--data-dir`/
 * `--registry-path` flags out of the full `argv`, returning both their values and every other
 * token untouched (including the command name and all of its own subcommand-specific flags) as
 * `rest` — see this file's own module doc, "Global flags are stripped before dispatch," for why
 * a dedicated single-pass scanner is used here instead of `flags.ts`'s `parseFlags` (whose
 * strict mode would throw on an unrelated subcommand flag, and whose permissive/heuristic mode
 * doesn't reliably agree with "always consume the very next token" for a value-taking flag
 * immediately followed by another `--flag`).
 *
 * @throws A plain `Error` when a recognized global flag is the last token with no value
 * following it — caught by {@link main}'s own error boundary, same as any other malformed-input
 * failure.
 */
function partitionGlobalArgv(argv: readonly string[]): PartitionedArgv {
  const names: ReadonlySet<string> = new Set(GLOBAL_FLAG_NAMES);
  const globals: Partial<Record<GlobalFlagName, string>> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    // Loop is bounded by argv.length, so this index is always in range —
    // noUncheckedIndexedAccess types it as possibly-undefined regardless.
    const token = argv[i]!;
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      const key = eq >= 0 ? token.slice(2, eq) : token.slice(2);
      if (names.has(key)) {
        if (eq >= 0) {
          globals[key as GlobalFlagName] = token.slice(eq + 1);
        } else {
          const value = argv[i + 1];
          if (value === undefined) throw new Error(`flag --${key} requires a value`);
          globals[key as GlobalFlagName] = value;
          i++;
        }
        continue;
      }
    }
    rest.push(token);
  }
  return { globals, rest };
}

/** Builds a `resolveDaemonUrl`-backed `resolveBaseUrl` closure from this binary's own parsed global flags. */
function buildResolveBaseUrl(globals: PartitionedArgv['globals'], env: NodeJS.ProcessEnv, warn: (message: string) => void): () => Promise<string> {
  const { 'daemon-url': daemonUrl, 'data-dir': dataDir, 'registry-path': registryPath } = globals;
  const discover: ResolveDaemonUrlOptions['discover'] =
    registryPath !== undefined
      ? createLocalDaemonDiscovery({ registryPath })
      : dataDir !== undefined
        ? createLocalDaemonDiscovery({ dataDir })
        : undefined;
  return () =>
    resolveDaemonUrl({
      flagUrl: daemonUrl ?? null,
      env,
      envVarName: DAEMON_URL_ENV_VAR,
      ...(discover !== undefined ? { discover } : {}),
      warn,
    });
}

/**
 * Parse `argv` (already stripped of `node`/script-path, i.e. `process.argv.slice(2)`) and
 * dispatch to the registered `run`/`daemon`/`version` commands. Never throws a raw error to its
 * caller under normal use — usage errors and daemon failures both exit through this package's
 * structured-error contract (`errors.ts`), via the injected (or default, real) `exit`.
 */
export async function main(argv: readonly string[], deps: MainDeps = {}): Promise<void> {
  const write = deps.write ?? defaultWrite;
  const writeErr = deps.writeErr ?? defaultWriteErr;
  const rawExit = deps.exit ?? ((code: number) => process.exit(code));
  const env = deps.env ?? process.env;

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    write(`${ROOT_USAGE}\n`);
    return;
  }

  // `--version`/`-v` as the very first token is a plain alias for `jini version` — see this
  // file's own module doc for why there is no separate "this package's own version" surface.
  const effectiveArgv = argv[0] === '--version' || argv[0] === '-v' ? ['version', ...argv.slice(1)] : argv;

  // Tracks whether `exit` was ever invoked, so the catch block below can tell "a nested command
  // already exited cleanly" (re-throw untouched) apart from "a genuinely raw, unhandled throw"
  // (reformat into a structured error) — see this file's own module doc, "Error boundary."
  let exitCalled = false;
  const exit = (code: number): never => {
    exitCalled = true;
    return rawExit(code);
  };

  let result: CommandDispatchResult;
  try {
    const { globals, rest } = partitionGlobalArgv(effectiveArgv);
    const resolveBaseUrl = buildResolveBaseUrl(globals, env, writeErr);
    const commandDeps = {
      resolveBaseUrl,
      write,
      writeErr,
      exit,
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
    };

    const registry = new CommandRegistry();
    registerRunCommands(registry, commandDeps);
    registerDaemonCommands(registry, commandDeps);
    registerVersionCommand(registry, commandDeps);

    result = await registry.dispatch(rest);
  } catch (error) {
    if (exitCalled) throw error;
    const message = error instanceof Error ? error.message : String(error);
    exitWithStructuredError({ code: 'invalid-flag', message }, { write: writeErr, exit });
    return;
  }

  if (result.kind === 'empty') {
    write(`${ROOT_USAGE}\n`);
    return;
  }
  if (result.kind === 'not-found') {
    exitWithStructuredError(
      { code: 'invalid-flag', message: `unknown command: "${result.name}". Run "jini --help" for usage.` },
      { write: writeErr, exit },
    );
  }
}

// Only run for real when this module is the actual process entrypoint (`node dist/main.js
// ...`, or the `jini` bin shim pnpm/npm links to it) — not merely imported, e.g. by this
// file's own tests importing the named `main` export above. Mirrors Node's CommonJS
// `require.main === module` idiom for ESM; see this file's own module doc.
const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  await main(process.argv.slice(2));
}
