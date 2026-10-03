# `@jini-ai/mcp`

Everything a Jini host needs on both sides of the Model Context Protocol. On the **server** side:
a generic mechanism for hosting a bounded set of MCP tools and read-only resources over stdio, plus
the kernel run tools (`start_run`, `get_run`, `cancel_run`, `list_agents`) already defined against
it, and a bootable `jini-mcp` binary an MCP client can spawn directly. On the **client/config** side:
a validated `mcp.json` schema with sanitizing read/write, a token
store with host-owned OAuth orchestration, and installation planning that registers an MCP server into external coding agents. Nothing
here assumes a product layout — a caller injects the daemon URL, the tool list, and the fetch
implementation.

## Install

```sh
npm install @jini-ai/mcp
```

No peer dependencies. `@modelcontextprotocol/sdk`, `undici`, `@cfworker/json-schema`,
`@jini-ai/core`, `@jini-ai/cli`, and `@jini-ai/platform`
are regular dependencies, installed automatically. Nothing here needs a native compile.

## What you get

**Hosting an MCP server** — `createMcpToolServer(requiredArgs, optionalArgs)` returns a handle whose `run({})` serves your
`McpToolDef[]` (and optional `McpResourceDef[]`) over this process's stdin/stdout. Duplicate tool
names or resource URIs throw at construction time. Supporting pieces: `buildToolIndex`,
`handleToolCall`, `toolsToList`, `buildResourceIndex`, `handleResourceRead`, `resourcesToList`,
`okResult`/`errorResult`, `requireString`, `createMcpIdleExitController`, and the
`McpServerLike`/`McpTransportLike`/`createServer`/`createTransport` seams for tests.

**Kernel tool and resource definitions** — `RUN_TOOLS` plus its members `startRunTool`, `getRunTool`,
`cancelRunTool`, `listAgentsTool`, `getActiveContextTool`; `KERNEL_RESOURCES` and
`activeContextResource`; and `createExecuteDelegatedToolTool({ runId }, optionalArgs)` for the MCP-callback delegated
tool-execution path. Daemon HTTP access for those definitions goes through `getDaemonJson` /
`postDaemonJson`, which bound response bytes and translate an internal `DaemonResponseTooLargeError`
into a redacted public error rather than buffering an unbounded body.

**The `jini-mcp` binary** — `package.json` declares `"bin": { "jini-mcp": "./dist/bin/serve.js" }`.
One process serves exactly one run for its lifetime: the spawning daemon injects the run id into the
child's environment, which is what lets `execute_delegated_tool` close over a fixed `runId` instead of
trusting a model-supplied one. The daemon URL comes from an environment variable via `@jini-ai/cli`'s
`resolveDaemonUrl`, with no baked-in default. It is deliberately not re-exported from the barrel, so
`import '@jini-ai/mcp'` can never start behaving like a spawned server.

**Server configuration** — `McpServerConfig` / `McpConfig` / `McpTransport` / `McpAuthMode` with
`readMcpConfig`, `writeMcpConfig`, `sanitizeMcpServer`, `sanitizeMcpConfig`,
`inferMcpAuthModeForUrl`, and `isManagedProjectCwd`. Per-agent config emitters:
`buildClaudeMcpJson`, `buildAcpMcpServers`, `buildOpenCodeMcpConfigContent`.

**Authentication** — OAuth is supplied by the host through credential and challenge ports.
The earlier in-package OAuth implementation has been retired. MCP neither imports an OAuth
engine nor retries a challenged request automatically.

**Token store** — `readTokensFile`, `sanitizeTokensFile`, `getToken`, `setToken`, `clearToken`,
`readAllTokens`, `isTokenExpired`.

**Installing into external agents** — `AGENT_SLUGS` / `isAgentSlug`, `planAgentInstall({ slug, spec, ctx })`
returning a discriminated `InstallPlan` (`CliInstallPlan` | `JsonInstallPlan` | `ManualInstallPlan`),
and `applyJsonInstall` / `removeJsonInstall` to execute the JSON-file variant. Plus
`buildMcpInstallPayload` for the install-info payload a UI renders.

**Client-side runtime helpers** — `extractRelativeRefs`, `isTextualMime`.

## Argument convention (breaking)

Public APIs take a required argument object and, when applicable, an optional settings object.
For example: `writeMcpConfig({ dataDir, body }, { filesystem })`,
`buildClaudeMcpJson({ servers }, { tokens })`, and
`handleToolCall({ name, tools, ctx }, { rawArgs })`.
Tool handlers receive `{ args, ctx }`; resource readers receive `{ ctx }`.
`requireString({ value, name })` returns the validated string, and
`isAgentSlug(args)` narrows `args.value` on a successful guard.
The binary's library entry point is `serve({}, deps)`; its error/exit ports take
`{ text }` and `{ code }`. SDK-facing signatures stay inside the adapters.

Daemon helpers use `getDaemonJson({ baseUrl, route }, options)` and
`postDaemonJson({ baseUrl, route, body }, options)`. Error constructors use `{ message, status }`
or `{ limitBytes }`. See [API.md](https://github.com/AINSEP/Jini/blob/main/packages/mcp/API.md) for the current contracts and the package integration
report for source provenance and deferred host rewiring.

Effectful lifecycle methods use empty objects: `handle.run({})`, `session.close({})`,
`channel.close({})`, `coordinator.reload({})`, `idle.noteActivity({})`, and `idle.dispose({})`.
SDK callbacks and zero-argument getters retain their ABI. Config sanitization rejects supplied
invalid transport/authentication modes. A configured but incomplete bundled stdio toolchain refuses
launch unless the host explicitly sets `{ allowIdentityFallback: true }` in resolver options;
allowed fallback carries a warning. Both toolchain variables absent selects ordinary identity
launching. See [API.md](https://github.com/AINSEP/Jini/blob/main/packages/mcp/API.md) for the security and port contracts.

Optional approval/revocation scopes and HTTP cancellation signals are omitted when absent.
Supplied scopes and signals are forwarded unchanged; unscoped memory approval records omit `scope`.

## Usage

```ts
import {
  createMcpToolServer,
  RUN_TOOLS,
  KERNEL_RESOURCES,
  okResult,
  requireString,
  type McpToolDef,
} from '@jini-ai/mcp';

const greetTool: McpToolDef = {
  name: 'greet',
  description: 'Say hello to someone.',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  },
  handler: async ({ args }) => {
    const who = requireString({ value: args.name, name: 'name' });
    return okResult({ payload: `hello ${who}` });
  },
};

const server = createMcpToolServer({
  name: 'example-mcp',
  version: '1.0.0',
  tools: [...RUN_TOOLS, greetTool],
  resolveBaseUrl: () => process.env.EXAMPLE_DAEMON_URL ?? 'http://127.0.0.1:4173',
}, {
  resources: KERNEL_RESOURCES,
  instructions: 'Use start_run to launch work; poll get_run for status.',
});

await server.run({}); // serves over this process's stdio until idle-exit
```

Read `McpToolDef` in `src/server/` before writing your own tool — the exact `handler` and
`inputSchema` field shapes are what the index and the SDK bridge consume.

## What's swappable

`createMcpToolServer` is injection-first: `resolveBaseUrl`, `fetchImpl`, `stdin`, `stdout`,
`createServer`, and `createTransport` are all parameters, which is what makes a full server testable
without spawning a process or opening a socket. The tool and resource lists are yours — `RUN_TOOLS`
and `KERNEL_RESOURCES` are convenience defaults, not a fixed set. `createExecuteDelegatedToolTool`
takes its run scoping from the caller. Fixed and not replaceable: the MCP wire framing itself (that
is `@modelcontextprotocol/sdk`'s job), the config sanitizers' validation rules, and the MCP handshake's step ordering.

## Runtime

`jini.runtime: "node"` — stdio streams, `node:fs` for the config and token stores, `node:crypto` for approval fingerprints. Universal entries are the ask-choice tool and
federation test doubles; federation and approvals require Node for hashing. The stdio entry
adds process, filesystem, and environment adapters.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See the archived provenance ledger for per-file provenance and scope decisions. Apache-2.0,
inherited from Open Design — see the repo `NOTICE`.

## Federation entries

`@jini-ai/mcp/federation` exposes admission/trust, protocol/HTTP sessions, bootstrap, reload,
fingerprints, and approval/revocation orchestration. Import process adapters and launch resolvers
from `@jini-ai/mcp/federation/stdio`, and in-memory sessions, scripted transports, and approval
stores from `@jini-ai/mcp/federation/testing`. The focused approval entry is
`@jini-ai/mcp/federation/approvals`. These stay separate from the root barrel to avoid naming
collisions and accidental process-adapter loading.

The host supplies product name, client information, credential policy, permission evaluator,
confirmation UI/exchanges, and current connection roster. A revocation gate checks the current
row on every call; the host composes its credential checks, including preset credentials.
See [API.md](https://github.com/AINSEP/Jini/blob/main/packages/mcp/API.md) for concrete object-argument examples.

All test, compiler, build, and pack verification is deferred under the owner directive.

## Design decisions

- [Remote annotations can narrow authority but cannot grant it](docs/decisions/DR-001-federation-admission.md).
- [Preserve structured protocol resources without exposing human secrets](docs/decisions/DR-002-protocol-resource-boundary.md).
- [Federation presets compose trusted ports](docs/decisions/DR-003-trusted-federation-composition.md).
- [Parked human exchanges need explicit deadlines](docs/decisions/DR-004-parked-human-exchange-deadlines.md).


Federation hosts supply `messages`, `errorCode` and `fingerprintDomain` explicitly. Import
`defaultFederationMessages` as neutral English or replace the full object with host wording.
Optional opaque `scope` travels separately from approval duration through store and webhook
ports. Existing approvals retain their fingerprint and storage-key bytes when the host supplies
its existing domain and partition. Logger and clock ports come from `@jini-ai/core/primitives`.
See `API.md` for the breaking signatures and the shared atomic writer's durability semantics.
MCP imports core text sanitization directly and has no dependency on the CLI shell.

## Managed project containment

Managed-project detection resolves real/lexical paths as before, then uses the
browser-safe `pathContains` helper from `@jini-ai/core/primitives`. Comparison
follows the host's path case policy and respects directory boundaries. A legal
project directory beginning with `..` is accepted; escaping the managed root
or selecting the root itself is still refused. Platform remains required for
other Node integrations, not for this pure containment check.
