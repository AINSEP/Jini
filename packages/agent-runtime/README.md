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

Browser consumers import the universal subpaths directly. The package root and
provider adapters load Node modules. Provider PKCE adapters delegate protocol
operations to `@jini-ai/oauth`; the host still owns endpoint policy, credentials,
callback handling and persistence. None of these entries selects a site layout.

## Design decisions

- [Provider adapters preserve native continuation and tool events](docs/decisions/DR-001-provider-native-tool-lifecycle.md).

Provider network predicates now live in `@jini-ai/platform/net`; secret redaction lives in `@jini-ai/core` and takes `{ input }` with `{ exactSecrets }`. Runtime no longer re-exports those utilities. Core's conservative policy retains model/request identifiers and returns categorized redaction markers. Model catalog hosts pass core `Clock` (`nowMs()`); ACP transport values use `UnknownRecord` to avoid claiming validated JSON.

PKCE providers pass `{ verifierBytes: 64 }` to the main OAuth API. Fixed-issuer token operations use its URL guard, bounded parser, timeout, redirect refusal and typed errors; the runtime maps normalized tokens into its existing persisted provider DTO. Pending callbacks use the main storage factory with an explicit exclusive expiry option and an unref scheduler. The cache is bounded to the main 256-entry default. The conversion report remains in the repository for relocation and is excluded from package files.
