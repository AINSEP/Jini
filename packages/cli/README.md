# `@jini-ai/cli`

CLI transport shell for driving a Jini daemon over HTTP: flag parsing, daemon-URL resolution,
local daemon discovery, and a pluggable command registry. This is deliberately **a first generic
slice, not the full `@jini-ai/cli` package** — it was extracted from Open Design's ~9,900-line
`cli.ts` by keeping only the transport/plumbing primitives that have nothing to do with any
product noun (project, plugin, brand, conversation, …); everything OD-domain-specific was left
behind (see the archived provenance ledger's classification table). The library barrel (`index.ts`) intentionally
registers nothing — it ships the building blocks a host pack uses to register real commands, plus
a small set of concrete commands (`run`, `daemon`, `version`) that wrap `@jini-ai/http`'s actual
routes, and a bootable `jini` binary (`src/main.ts`, wired via `package.json`'s `bin` field) that
dispatches them.

## Install

```sh
npm install @jini-ai/cli
```

No peer dependencies. Depends on `@jini-ai/core` (for the `token()`-based transport tokens) and
`@jini-ai/sidecar` (for local daemon discovery's on-disk registry read).

## What you get

- **Flag/positional parsing** — `parseFlags`, `positionalArgs`, `coerceCliValue`.
- **Daemon-URL resolution** — `resolveDaemonUrl` (flag → env var → injected `discover()` probe →
  default, in that order), `sanitizeDaemonUrlForDisplay`, `daemonUrlPolicyWarning`.
- **Local daemon discovery** — `createLocalDaemonDiscovery({ dataDir } | { registryPath })`, a
  `resolveDaemonUrl`-compatible `discover` probe reading `@jini-ai/sidecar`'s on-disk registry
  record (and verifying the recording daemon's pid is still alive before trusting it).
- **HTTP transport** — `postJsonToDaemon`, `getJsonFromDaemon`, `surfaceFetchError` — bounded,
  size-capped, structured-error-aware daemon requests.
- **Structured errors** — `exitWithStructuredError`, `DEFAULT_CLI_EXIT_CODES`,
  `structuredErrorData` — maps an error code to a stable exit code and a `{ error: { code,
  message, data } }` stderr envelope.
- **Command registry** — `CommandRegistry` (`.add({ name, handler }, { usage?, override? })`,
  `.dispatch({ argv }, { valueFlags? })`), `CommandDispatchResult`, `CommandHandler` — the generic
  "first-non-flag-token dispatch" shape a pack's `Pack['cli']` hook registers against.
- **Built-in commands** — `registerRunCommands` (`run start|list|get|cancel|watch`),
  `registerDaemonCommands` (`daemon status|stop`), `registerVersionCommand` (`version`) — each a
  thin transport over `@jini-ai/http`'s run/daemon-status routes.
- **Prompt/body input helpers** — `readPromptFromFlags`/`readBodyFromFlags` (`--prompt`/
  `--prompt-file`/stdin conventions) and `@jini-ai/core/text`'s `stripControlSequences`.

## Usage

```ts
import { CommandRegistry, resolveDaemonUrl, registerRunCommands, exitWithStructuredError } from '@jini-ai/cli';

const registry = new CommandRegistry({});

registerRunCommands({ registry,
  resolveBaseUrl: () => resolveDaemonUrl({}, { envVarName: 'JINI_DAEMON_URL', defaultUrl: 'http://127.0.0.1:4317' }),
});

const result = await registry.dispatch({ argv: process.argv.slice(2) });
if (result.kind === 'not-found') {
  exitWithStructuredError({ code: 'invalid-flag', message: `unknown command "${result.name}"` });
}
```

For a ready-to-run entrypoint rather than composing the registry yourself, install this package
and run its `jini` binary directly (`npx jini run list --daemon-url http://127.0.0.1:4317`).

## What's swappable

Command handlers and registrars receive `resolveBaseUrl` in the required argument object; optional I/O ports belong in the second object. Call a discovery probe with `discover({ env }, { timeoutMs })`.

`resolveDaemonUrl`'s `discover` callback is the intended injection point for daemon-discovery
strategy — `createLocalDaemonDiscovery` is the one concrete implementation shipped, but any
`({ env }, { timeoutMs }) => Promise<string | null>` works. `CommandRegistry` itself is the seam a pack
uses to add or `override` commands. The exit-code table (`DEFAULT_CLI_EXIT_CODES`) is a small
default a caller extends with its own `code → exitCode` entries rather than a fixed, closed set.

## Runtime

Node-only.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See the archived provenance ledger for per-file provenance and scope decisions. Apache-2.0.

## Introspection and I/O ports

The universal `./introspection` entry reads structural Commander trees and builds MCP schemas with caller-owned exclusions and tool-name prefixes. It is also exported from the Node library barrel. The binary stays separate. See [API.md](https://github.com/AINSEP/Jini/blob/main/packages/cli/API.md) for the object argument convention, including injected I/O ports.

## Design decisions

- [Introspection derives from the live command tree](docs/decisions/DR-001-live-command-introspection.md).


Text sanitization and terminal control stripping now live at `@jini-ai/core/text`, with their
bounded lowercase-marker output preserved. Former direct `redactSecretLike` callers use core
`redactSecrets({ input }, { policy: 'aggressive' })`; this explicit policy emits category markers
and also masks recognized PII. Core's default stays conservative for diagnostics. The CLI keeps
`sanitizeUnknownDeep` for bounded recursive JSON. Loopback warnings use `@jini-ai/platform/net`.
