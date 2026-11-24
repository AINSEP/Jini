# `@jini-ai/agent-runtime`

Runtime-side content and execution code for agent-driven artifact
generation: brand-agnostic craft knowledge and portable skill packages
(both product-neutral per root `AGENTS.md`) plus a real TypeScript runtime
surface — the `runtimes/` -> agent-runtime adapter registry/detection/
launch/stream-parser port and the `agent-protocol/` ACP + pi-rpc subprocess
transport (see `src/index.ts`'s own header comment and the archived provenance ledger's
"Barrel merge" section for the full inventory), plus `src/model-registry.ts`
below. This top-level blurb has historically lagged that TS surface's
growth — treat `src/index.ts` and the archived provenance ledger as the source of truth
for what's actually implemented.

## `src/model-registry.ts`

The provider/model/agent-picker vocabulary (`ModelProvider`,
`ModelCatalogOption` — exported as `ModelOption` is already taken by
`agent-protocol/acp/models.ts`'s narrower ACP-probe shape —,
`AgentDefinition`, `AgentDiagnostic`, `CredentialStatus`, ...) and a handful
of pure helpers (credential-status resolution, model-list merging, a stable
model-catalogue cache key, model-choice normalization against a live
catalogue) for any consumer building a "pick a model/agent" UI — e.g.
`@jini-ai/chat-react`'s `features/model-picker/` slice. Distinct from
`src/registry.ts` (the static `BASE_AGENT_DEFS` CLI-adapter catalog). See
the archived provenance ledger for full provenance.

## Archived craft and skill content

The former craft rulebooks and portable skill documents are archived with the extraction records. No runtime loader or build asset-copy step reads them, so they are outside this package's distributable surface. Source execution code and provider/cache APIs remain described below.

## Runtime APIs and subpaths

Public functions, constructors, stream methods and custom ports use at most two
argument objects: required inputs first, optional controls second. Existing
names are retained, but positional callers must migrate together with their
port implementations. See [API.md](https://github.com/AINSEP/Jini/blob/main/packages/agent-runtime/API.md) for current examples and
[API.md](https://github.com/AINSEP/Jini/blob/main/packages/agent-runtime/API.md) for the current public contracts.

Omit optional properties to use their defaults; exact optional-property types
exclude explicitly assigned `undefined`. Model parsers accept `{ stdout }`.

| Import | Runtime | Surface |
| --- | --- | --- |
| `@jini-ai/agent-runtime` | Node | CLI registry, launch/detection, protocols, providers, tool turns and caches |
| `@jini-ai/agent-runtime/providers/tool-turn` | Node | Provider-neutral tool turns, replaceable adapters, Gemini schema helpers |
| `@jini-ai/agent-runtime/model-catalog/cache` | Universal | Instance-owned discovery cache and model union |
| `@jini-ai/agent-runtime/providers/sse-decode` | Universal | Inbound SSE frame decoder over an async iterable |
| `@jini-ai/agent-runtime/providers/credentials` | Universal | Bring-your-own-key credential resolution: request-supplied first, then a host-stored row through an injected `readStored` |

Browser consumers import the universal subpaths directly. The package root and
provider adapters load Node modules. Provider PKCE adapters delegate protocol
operations to `@jini-ai/oauth`; the host still owns endpoint policy, credentials,
callback handling and persistence. None of these entries selects a site layout.
OAuth is a regular runtime dependency because the root statically imports its
redaction and PKCE helpers; consumers receive it automatically on installation.

## Design decisions

- [Provider adapters preserve native continuation and tool events](docs/decisions/DR-001-provider-native-tool-lifecycle.md).

Provider network predicates now live in `@jini-ai/platform/net`; secret redaction lives in `@jini-ai/core` and takes `{ input }` with `{ exactSecrets }`. Runtime no longer re-exports those utilities. Core's conservative policy retains model/request identifiers and returns categorized redaction markers. Model catalog hosts pass core `Clock` (`nowMs()`); ACP transport values use `UnknownRecord` to avoid claiming validated JSON.

PKCE providers pass `{ verifierBytes: 64 }` to the main OAuth API. Fixed-issuer token operations use its URL guard, bounded parser, timeout, redirect refusal and typed errors; the runtime maps normalized tokens into its existing persisted provider DTO. Pending callbacks use the main storage factory with an explicit exclusive expiry option and an unref scheduler. The cache is bounded to the main 256-entry default. The conversion report remains in the repository for relocation and is excluded from package files.

## Wiring

- **Provider tool turns / BYOK** (`@jini-ai/agent-runtime/providers/tool-turn`): the host calls
  `runProviderToolTurn({ protocol, adapters: providerTurnAdapters, apiKey, model, system, messages, tools, executeTool, onEvent }, { baseUrl, maxTokens, maxToolTurns, signal, getToolSnapshot, onSchemaFallback, onUnexposedToolCall })`
  directly — no host wrapper. The host injects `executeTool` (its own tool surface/executor),
  `onEvent` (its transport), any product policy values (e.g. its meta-tool `maxToolTurns`, a
  visitor `maxTokens` cap, a stored-credential `baseUrl`) and may replace any entry of `adapters`
  (tests inject a fake adapter here instead of mocking the module). A stored free-form provider
  string is narrowed with `resolveProviderProtocol({ provider })` (null when no adapter matches).

- **Stored-credential live Claude models** (`@jini-ai/agent-runtime/model-catalog/live-discovery`):
  the host creates ONE instance per app lifetime with
  `createLiveModelDiscovery({ resolveCredential, defaultBaseUrl, clock, discover: fetchLiveClaudeModels })`
  — the TTL cache is instance-owned, never module state. The host injects `resolveCredential` (its
  own stored execution-credential read + decrypt for `{ workspaceId, principalId }`, `null` when
  absent), `defaultBaseUrl` (its provider catalog's Anthropic endpoint) and `clock`; its agent-list
  handler merges the result into the static list with `unionModels({ fallback, live })`.
- **CLI inventory cache** (`@jini-ai/agent-runtime/cli-probe-cache`): the host calls
  `createCliProbeCache({ initial, probe }, { expiresAt, retryAfterMs })`, injecting `initial` (the
  empty/placeholder snapshot), `probe` (its detection/inventory port) and optionally the catalog
  expiry reader and failure cooldown (e.g. `MODEL_CATALOG_TTL_MS`/`MODEL_NEGATIVE_TTL_MS`). HTTP
  readers call `read({})`; Rescan calls `read({ force: true })`.
- **Custom instructions overlay** (`@jini-ai/agent-runtime/custom-instructions`): the host injects
  `settingsRepo`, `getEffective` (from `@jini-ai/core/settings`), `instructionsNamespace` (its
  settings namespace holding the `custom` key) and optionally `settingsReady`. The daemon builds one
  `createCustomInstructionsCache(deps, { workspaceId })`, calls `refresh()` before each run and wires
  `readOverlay()` into `PromptAugmenter.systemOverlay()`; BYOK turns call
  `resolveCustomInstructions` + `formatCustomInstructionsOverlay` directly.
- **Native permission layer saves** (`@jini-ai/agent-runtime/native-permissions`): a host reads its
  stored permission layer raw (for example with `readUserLayerObject` from `@jini-ai/core/settings`)
  and calls `patchNativePermissionLayer({ raw, defaults, agentId?, capabilities?, enabled?,
  masterSaveFields? })`, injecting `defaults` (its product permission defaults) and
  `masterSaveFields` (fields stamped on a master-level save, e.g. a migration marker), then writes
  the result back through its settings `set`.
