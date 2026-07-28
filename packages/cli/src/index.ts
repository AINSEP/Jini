/**
 * @module @injini/cli
 *
 * CLI transport-shell: HTTP-client-mode generic transport/infra ported from
 * OD's `apps/daemon/src/cli.ts` (extraction-plan §3 / §8 task 9). See
 * `source-map.md` for the full classification of what was and wasn't
 * ported. This is a first generic slice, not the full `@injini/cli` package —
 * no pack has registered against `CommandRegistry` yet because no HTTP-
 * client-mode pack exists in this repo to call.
 */
export * from './flags.js';
export * from './daemon-url.js';
export * from './errors.js';
export * from './http.js';
export * from './prompt.js';
export * from './redact.js';
export * from './usage.js';
export * from './command-registry.js';
export * from './run-command.js';
export * from './daemon-command.js';
export * from './version-command.js';
export * from './local-daemon-discovery.js';
export * from './tokens.js';
// NOTE: `main.ts` (the bootable `jini` binary, wired via `package.json`'s `"bin"` field) is
// deliberately NOT re-exported here. This barrel is imported as a plain library dependency;
// `main.ts` parses `process.argv` and may call `process.exit` as a side effect of being
// imported for real (guarded so that merely importing its named `main` export does not trigger
// that side effect — see `main.ts`'s own module doc) — bundling it into this barrel would mean
// `import '@injini/cli'` could start behaving like a CLI invocation.
