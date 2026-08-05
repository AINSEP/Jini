# Bug 2, prior-art check: does Open Design solve Local CLI model discovery?

**Date:** 2026-08-05
**Agent:** Programmer
**Scope:** Read-only recon against `/Users/la/Programming/OSS-Repos/open-design` (reference repo,
not modified, not built, not committed to). No code changed in Jini or Tovu.
**Tooling:** `codebase-memory-mcp` — already indexed (`Users-la-Programming-OSS-Repos-open-design`,
289k nodes, `status: ready`, `head_sha == base_sha`, no reindex needed) — `search_graph`,
`search_code`, `get_code_snippet`, `trace_path`. No indexing run in anyone else's session.

## Short answer: no. OD has two separate mechanisms; the live one requires the exact BYOK shape
we already ruled out, and the CLI-agent one is the same static array we already have — verbatim.

## 1. Where OD's model list actually comes from — two different subsystems, not one

**Subsystem A — the CLI-agent registry (`apps/daemon/src/runtimes/defs/*.ts`).** This is what
Jini's `packages/agent-runtime/src/defs/*.ts` was ported from (per Jini's own file header:
"Ported verbatim from OD's `apps/daemon/src/runtimes/defs/claude.ts`"). Confirmed via
`get_code_snippet` that OD's `claude.ts:44` still reads, verbatim:

```
fetchModels: async (_resolvedBin, env) => loadMmdRouteModels(env, CLAUDE_FALLBACK_MODELS),
```

And OD's `CLAUDE_FALLBACK_MODELS` (`claude.ts:6-14`) is **byte-for-byte identical** to what Jini
had before my edit — same seven entries, same ids, same labels, `claude-opus-4-5`/
`claude-sonnet-4-5`/`claude-haiku-4-5` and all. This is the exact source both codebases share, and
OD has not evolved it. **For the Local CLI / spawned-`claude`-binary path, OD has no live
discovery — it's the identical static-fallback-only mechanism we already have.**

**Subsystem B — provider connection-test / BYOK (`apps/daemon/src/integrations/provider-models.ts`).**
This is a real live call. `listProviderModels` (`provider-models.ts:294-427`) does an actual
`fetch()` to the configured provider. For `protocol === 'anthropic'` specifically:
- `providerModelsUrl` (`:238-256`) builds `GET {baseUrl}/v1/models?limit=1000`.
- `providerModelsHeaders` (`:258-278`) sends `x-api-key: apiKey` + `anthropic-version: 2023-06-01`.
- `extractAnthropicModels` (`:181-201`) reads `data.data[].{id, display_name}` off the response —
  this is genuinely Anthropic's real `/v1/models` endpoint, matching exactly what the Coordinator
  described (`id`, `display_name` fields, no `context_window`).

Traced its caller chain with `trace_path` (inbound, depth 4): `listProviderModels` ←
`registerChatRoutes` ← `startServer` ← `startDaemonRuntime`/`startDaemonSidecar`/
`runDaemonCliStartup`/`runDaemonStart`. `registerChatRoutes` exposes it at the
`/api/provider/models` route the Coordinator's own grep already surfaced (also confirmed present
via `search_graph`). This is OD's **custom-provider "test connection" feature** — a Settings-time
flow where a user configuring their own OpenAI-, Anthropic-, or Google-compatible endpoint supplies
a base URL + API key and OD calls that provider's real API to populate the model picker *for that
custom connection*. `e2e/ui/settings-media-providers.test.ts` (one of the files the Coordinator
flagged) exercises this same flow for the media/image-generation providers, not the coding-agent
picker.

## 2. What credential does the live path use — the BYOK shape, confirmed

`ProviderModelsInput.apiKey` is a required, non-optional parameter threaded straight into both the
URL builder and the header builder — there's no fallback, no ambient/env-sourced key, no reuse of
an installed CLI's own auth anywhere in this function or its callers. **The user must have typed an
API key into OD's own settings UI for that specific provider connection.** That's exactly the BYOK
shape already in Jini/Tovu (a user-supplied key, stored and used only for that mode) and already
ruled out for the *Local CLI* path in the prior investigation — Tovu's Local CLI execution mode
carries no such credential by design.

## 3. Is there a credential-free mechanism worth adopting? Checked, found none

Looked specifically for the shapes the Coordinator named — cached-manifest-with-refresh,
build-time-generated list, config-driven proxy route — beyond what's already in `defs/claude.ts`:
- No build script or generation step for `CLAUDE_FALLBACK_MODELS` — grepped `docs/agent-adapters.md`
  (the architecture doc for this exact subsystem, one of the files flagged) top to bottom for
  Claude-specific content; it documents invocation flags, streaming format, skill-loading, and
  permission passthrough for Claude Code, and says nothing about model enumeration beyond the code
  already covered.
- The "config-driven proxy route" shape *does* exist — it's `loadMmdRouteModels` itself, i.e. the
  same `~/.config/mms/model-routes.json` mechanism Jini already has (confirmed in the prior report:
  present in source, absent as a file on this machine). OD doesn't extend or improve on it; it's
  the same code.
- No cache-with-TTL, no scheduled refresh, nothing resembling `rememberLiveModels`'s "last surfaced
  to the UI" cache being seeded from anywhere other than the same static array or the same routes
  file.

## 4. Verdict

**This does not add a fourth option. It confirms the shape of the third: "wire a credential in"
would mean building the same thing OD already has — a Settings-time, user-supplied Anthropic API
key feeding a live `/v1/models` call — not something novel or something that sidesteps the
no-ambient-credential constraint.** The three options from the first report stand unchanged:

- (a) accept `claude` stays fallback-only, matching what OD itself ships for this exact path;
- (b) deliberately build the BYOK-shaped live call for the Local CLI picker too — which is now a
  known, working reference implementation (OD's `provider-models.ts`) to model it on, if the user
  decides the extra Settings step (paste an Anthropic API key just for model listing) is worth it;
- there is no (c). No credential-free live discovery exists in OD for this path either.

Nothing implemented, no OD file touched, no OD build/install run. Bug 1 and Bug 2's static-array
freshening remain as previously committed (`9525b794`, `be16c225`) and unaffected.
