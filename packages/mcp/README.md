# `@jini-ai/mcp`

Everything a Jini host needs on both sides of the Model Context Protocol. On the **server** side:
a generic mechanism for hosting a bounded set of MCP tools and read-only resources over stdio, plus
the kernel run tools (`start_run`, `get_run`, `cancel_run`, `list_agents`) already defined against
it, and a bootable `jini-mcp` binary an MCP client can spawn directly. On the **client/config** side:
a validated `mcp.json` schema with sanitizing read/write, an OAuth 2.1 + PKCE flow with a token
store, and installation planning that registers an MCP server into external coding agents. Nothing
here assumes a product layout — a caller injects the daemon URL, the tool list, and the fetch
implementation.

## Install

```sh
npm install @jini-ai/mcp
```

No peer dependencies. `@modelcontextprotocol/sdk`, `undici`, `@jini-ai/cli`, and `@jini-ai/platform`
are regular dependencies, installed automatically. Nothing here needs a native compile.

## What you get

**Hosting an MCP server** — `createMcpToolServer(options)` returns a handle whose `run()` serves your
`McpToolDef[]` (and optional `McpResourceDef[]`) over this process's stdin/stdout. Duplicate tool
names or resource URIs throw at construction time. Supporting pieces: `buildToolIndex`,
`handleToolCall`, `toolsToList`, `buildResourceIndex`, `handleResourceRead`, `resourcesToList`,
`okResult`/`errorResult`, `requireString`, `createMcpIdleExitController`, and the
`McpServerLike`/`McpTransportLike`/`createServer`/`createTransport` seams for tests.

**Kernel tool and resource definitions** — `RUN_TOOLS` plus its members `startRunTool`, `getRunTool`,
`cancelRunTool`, `listAgentsTool`, `getActiveContextTool`; `KERNEL_RESOURCES` and
`activeContextResource`; and `createExecuteDelegatedToolTool(options)` for the MCP-callback delegated
tool-execution path. Daemon HTTP access for those definitions goes through `getDaemonJson` /
`postDaemonJson`, which raise `DaemonResponseTooLargeError` rather than buffering an unbounded body.

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

**OAuth 2.1 / PKCE** — `generateCodeVerifier`, `deriveCodeChallenge`, `generateState`,
`discoverProtectedResource`, `discoverAuthServer`, `registerClient`, `getOrRegisterClient`,
`buildAuthorizeUrl`, `exchangeCodeForToken`, `refreshAccessToken`, `PendingAuthCache`, and the
one-call `beginAuth`.

**Token store** — `readTokensFile`, `sanitizeTokensFile`, `getToken`, `setToken`, `clearToken`,
`readAllTokens`, `isTokenExpired`.

**Installing into external agents** — `AGENT_SLUGS` / `isAgentSlug`, `planAgentInstall(context)`
returning a discriminated `InstallPlan` (`CliInstallPlan` | `JsonInstallPlan` | `ManualInstallPlan`),
and `applyJsonInstall` / `removeJsonInstall` to execute the JSON-file variant. Plus
`buildMcpInstallPayload` for the install-info payload a UI renders.

**Client-side runtime helpers** — `extractRelativeRefs`, `isTextualMime`.

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
  handler: async (args) => {
    const who = args.name;
    requireString(who, 'name'); // asserts, throws a caller-facing error otherwise
    return okResult(`hello ${who}`);
  },
};

const server = createMcpToolServer({
  name: 'example-mcp',
  version: '1.0.0',
  tools: [...RUN_TOOLS, greetTool],
  resources: KERNEL_RESOURCES,
  resolveBaseUrl: () => process.env.EXAMPLE_DAEMON_URL ?? 'http://127.0.0.1:4173',
  instructions: 'Use start_run to launch work; poll get_run for status.',
});

await server.run(); // serves over this process's stdio until idle-exit
```

Read `McpToolDef` in `src/server/` before writing your own tool — the exact `handler` and
`inputSchema` field shapes are what the index and the SDK bridge consume.

## What's swappable

`createMcpToolServer` is injection-first: `resolveBaseUrl`, `fetchImpl`, `stdin`, `stdout`,
`createServer`, and `createTransport` are all parameters, which is what makes a full server testable
without spawning a process or opening a socket. The tool and resource lists are yours — `RUN_TOOLS`
and `KERNEL_RESOURCES` are convenience defaults, not a fixed set. `createExecuteDelegatedToolTool`
takes its run scoping from the caller. Fixed and not replaceable: the MCP wire framing itself (that
is `@modelcontextprotocol/sdk`'s job), the config sanitizers' validation rules, and the OAuth flow's
step ordering.

## Runtime

`jini.runtime: "node"` — stdio streams, `node:fs` for the config and token stores, `node:crypto` for
PKCE.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See [source-map.md](./source-map.md) for per-file provenance and scope decisions. Apache-2.0,
inherited from Open Design — see the repo `NOTICE`.
