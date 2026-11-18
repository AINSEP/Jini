# How each agent CLI behaves on a long MCP tool call

Written 2026-11-17 for the tool-call fixes plan (sheet S16a, mechanism M9). This file records what is **known**
about every agent CLI that can receive Jini's tools, and for each field says how it was learned. It changes no runtime
behaviour and no generated config. A cell is filled only from the CLI itself (its own output, its own bundled
configuration text, its own code) with the version and the source named; a CLI that is not installed here, or could not
be driven here, is `unknown` and says why. Nothing in this file comes from memory.

`src/defs/__tests__/mcp-tool-call-matrix.test.ts` reads the table below and fails when a def gains or loses
`externalMcpInjection` without a row, when a row names a def that no longer has the transport it claims, or when
`gemini` becomes selectable or `aider` stops being `no-client`.

## What was and was not possible in this environment

- No model credentials are available to a nested CLI run here, so **no probe against a recording MCP server was run**.
  Every "sends `_meta.progressToken`" and "resets its timer on progress" cell is therefore `source-read` (read from the
  installed CLI's own code or configuration text) or `unknown`. Nothing is marked `measured on the wire`.
- Installed and examined: Claude Code 2.1.326 (`claude --version`; the binary at `/opt/claude-code/bin/claude`),
  Codex 0.169.1 (`codex --version`, `npm i @openai/codex`), OpenCode 1.19.6 (`opencode --version`, `npm i opencode-ai`).
- Not installed (`command -v` found nothing on 2026-11-17): every other def listed below. They are `unknown`.

## The matrix

Columns: **Def** is `AgentDef.id` (`packages/agent-runtime/src/defs/`). **Transport** is the def's `externalMcpInjection`.
**State** is `source-read`, `unknown` or `unsupported: <why>`. **progressToken** is whether `tools/call` carries
`_meta.progressToken`. **Resets on progress** is whether a `notifications/progress` frame restarts the CLI's tool-call
timer. **Timeout key** is the per-server key or environment variable and its unit. **Default** is the default limit.

| Def | CLI | Transport | State | Version | progressToken | Resets on progress | Timeout key | Default | Source |
|---|---|---|---|---|---|---|---|---|---|
| `claude` | Claude Code | `claude-mcp-json` | source-read | 2.1.326 | yes: `callTool` passes an `onprogress` handler and the client's `request()` then adds `_meta.progressToken` | no for the per-server key: its own description says progress does not extend it | `timeout` per server in the MCP JSON (milliseconds, values below 1000 are ignored); environment `MCP_TOOL_TIMEOUT` (milliseconds) | unknown: a clamp of 300000 ms sits beside the resolver, but the minified scope of that constant was not confirmed | S1 |
| `codex` | Codex | `codex-toml` | source-read | 0.169.1 | unknown: the binary contains the word `progressToken` once; what sets it was not isolated | unknown | `tool_timeout_sec` per `[mcp_servers.<name>]` (unit seconds, from the key name; no description text found) | unknown (`null` when unset) | S2 |
| `opencode` | OpenCode | `opencode-env-content` | source-read | 1.19.6 | unknown | unknown: `resetTimeoutOnProgress` appears three times in the bundle; the call site was not isolated | `timeout` per MCP server (milliseconds) | 5000 ms as the key describes it ("MCP server requests"); whether that bounds `tools/call` or only discovery is unknown | S3 |
| `antigravity` | Antigravity (`agy`) | `env-passthrough` | unknown | not installed | unknown | unknown | unknown | unknown | S0 |
| `amr` | AMR (`vela`) | `acp-merge` | unknown | not installed | unknown | unknown | unknown | unknown | S0 |
| `devin` | Devin | `acp-merge` | unknown | not installed | unknown | unknown | unknown | unknown | S0 |
| `hermes` | Hermes | `acp-merge` | unknown | not installed | unknown | unknown | unknown | unknown | S0 |
| `trae-cli` | Trae CLI (`traecli`) | `acp-merge` | unknown | not installed | unknown | unknown | unknown | unknown | S0 |
| `kimi` | Kimi | `acp-merge` | unknown | not installed | unknown | unknown | unknown | unknown | S0 |
| `kiro` | Kiro (`kiro-cli`) | `acp-merge` | unknown | not installed | unknown | unknown | unknown | unknown | S0 |
| `kilo` | Kilo | `acp-merge` | unknown | not installed | unknown | unknown | unknown | unknown | S0 |
| `vibe` | Vibe (`vibe-acp`) | `acp-merge` | unknown | not installed | unknown | unknown | unknown | unknown | S0 |
| `reasonix` | Reasonix | `acp-merge` | unknown | not installed | unknown | unknown | unknown | unknown | S0 |
| `codebuddy` | Codebuddy | `claude-mcp-json` | unknown | not installed | unknown | unknown | unknown | unknown | S0 |
| `mimo` | Mimo | `mimo-env-content` | unknown | not installed | unknown | unknown | unknown | unknown | S0 |
| `cline` | Cline | `acp-merge` | unknown | not installed | unknown | unknown | unknown | unknown | S0 |
| `goose` | Goose | `acp-merge` | unknown | not installed | unknown | unknown | unknown | unknown | S0 |
| `auggie` | Auggie | `acp-merge` | unknown | not installed | unknown | unknown | unknown | unknown | S0 |
| `gemini` | Gemini CLI | none | unsupported: retired def | none | none | none | none | none | S4 |
| `aider` | Aider | none | unsupported: no tool transport | none | none | none | none | none | S5 |

## Sources

- **S0**: `command -v <bin>` printed nothing on 2026-11-17 in the plan's cloud environment (binary names are the defs'
  `bin` field). The row is `unknown` until the CLI is installed and probed.
- **S1** (Claude Code 2.1.326, read from the installed binary's embedded JavaScript, 2026-11-17):
  - The MCP client's `request()` sets the token whenever an `onprogress` handler is given:
    `if(r?.onprogress)this._progressHandlers.set(u,r.onprogress),f.params={...e.params,_meta:{...e.params?._meta||{},progressToken:u}}`.
    The tool call passes one: `…,timeout:Pe?Cc:Ue,onprogress:(It)=>{if(ee.armedAt=0,Ct=Date.now(),$o?.reportBackgroundProgress(h,It),…`.
    This is read from code, not seen on the wire.
  - The per-server timeout's own description string: "Per-server tool-call timeout in milliseconds. Overrides the
    MCP_TOOL_TIMEOUT environment variable for this server. Hard wall-clock limit per call; progress notifications do not
    extend it. Values below 1000ms are ignored (falls through to MCP_TOOL_TIMEOUT or the default)." The schema entries
    for `stdio`, `sse` and `http` servers carry `timeout:` with that description.
  - The resolver: `function bs(e){let r=(e?.timeout!==void 0&&e.timeout>=1000?e.timeout:void 0)??s.MCP_TOOL_TIMEOUT??ep;return Math.min(Math.max(r,1000),Cc)}`.
    `Cc=300000` appears in the same bundle; which `Cc` and `ep` this function binds is not certain in minified code, so
    the default is recorded as `unknown`.
  - Consequence for S16b: raising this key is a wall-clock limit that progress frames do **not** move.
- **S2** (Codex 0.169.1): `codex mcp add recorder -- echo hi` followed by `codex mcp get recorder --json` printed
  `"startup_timeout_sec": null` and `"tool_timeout_sec": null` for the new server, and the generated
  `config.toml` held only `command` and `args`. The unit is read from the key name.
- **S3** (OpenCode 1.19.6, the installed binary's bundled configuration schema): "Timeout in ms for MCP server requests.
  Defaults to 5000 (5 seconds) if not specified." on both the local and the remote MCP server config.
- **S4**: `src/defs/__tests__/gemini.test.ts:5-11` asserts `AGENT_DEFS` has no `gemini`, `getAgentDef({ id: 'gemini' })`
  is `null` and the definitions barrel exports no `geminiAgentDef`. Only `src/defs/gemini/event-stream.ts` remains.
  Its registry successor is Antigravity (`antigravity`, row above). Owner decision OD-11: recorded, not built.
- **S5**: `src/defs/aider.ts:8` declares `mcpIsolation: 'no-client'` and `src/defs/aider.ts:80-86` says why: Aider has no
  native MCP client, and "there is nowhere for a bridged tool call to land". No tool call can happen for it, so none
  of the failure classes C1 to C8 can occur. Owner decision OD-11: recorded, not built.

## What this means for the next sheet (S16b)

- Only measured or source-read keys may be emitted by a generated config: today that is Claude's `timeout`
  (milliseconds, a hard limit that progress does not extend) and Codex's `tool_timeout_sec`. OpenCode's `timeout` is
  documented for "server requests" and its effect on `tools/call` is not established. Every `unknown` row stays without
  a key until the CLI is installed and probed.
- Because Claude's per-server limit ignores progress, the keepalive from `packages/mcp/src/server/call-progress.ts`
  cannot extend it. A host that wants a call to outlive that limit must raise the key, not rely on progress.
