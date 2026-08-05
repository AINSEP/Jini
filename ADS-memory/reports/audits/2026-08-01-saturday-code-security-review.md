# Saturday code and security review

Date: 2026-08-04

## Scope

Final current source only. Reviewed the current Jini implementations touched by the Saturday work: endpoint policy and provider connections, credential redaction and source forms, media-provider persistence, asset-grid updates, iframe pooling, integrations, sidebar behavior, and the admin package move. Historical snapshots were not used to determine findings.

## Findings

### High: endpoint validation is bypassable after the DNS preflight

`validateBaseUrlResolved()` resolves and validates a hostname, but callers then pass the original hostname to `fetch()`. Fetch resolves it again, so a DNS-rebinding endpoint can pass the public-address check and subsequently connect to a private address. Fetch also follows redirects without validating each hop, providing the same SSRF bypass through a public endpoint that returns a redirect to a private address. Provider requests can carry API keys and their response/error text reaches the caller.

Affected code:

- `packages/agent-runtime/src/providers/connection-guard.ts:198-224`
- `packages/agent-runtime/src/providers/openai-chat.ts:274-279`
- `packages/agent-runtime/src/providers/google-messages.ts:301-314`
- `packages/agent-runtime/src/providers/anthropic-messages.ts:337-350`
- `packages/agent-runtime/src/providers/ollama-chat.ts:356-369`
- `packages/agent-runtime/src/providers/model-catalog.ts:313-325`
- `packages/agent-runtime/src/providers/connection-test.ts:346-386`

Fix direction: use a dispatcher/agent that connects only to the validated IP while preserving the original hostname for TLS and Host, and disallow redirects or revalidate and repin every redirect target. Add DNS-rebinding and private-redirect regression coverage.

### Medium: a clear can be undone by a concurrent reload and queued save

`clearProvider()` deletes an entry but does not add a deletion tombstone to `pendingProviderIds`. If an earlier whole-map save is in flight, then Clear, Reload, and the first save response occur in that order, reload merges the old server marker back into local state. The queued follow-up write subsequently sends that marker instead of the cleared map, so the credential remains configured.

Affected code:

- `packages/ui/src/features/media-providers/react/hooks/useMediaProvidersTab.ts:157-175`
- `packages/ui/src/features/media-providers/react/hooks/useMediaProvidersTab.ts:236-258`
- `packages/ui/src/features/media-providers/react/hooks/useMediaProvidersTab.ts:292-315`
- `packages/ui/src/features/media-providers/rules.ts:86-108`

Fix direction: represent a clear as a pending tombstone, preserve that tombstone across reloads, and retire it only after its ordered write succeeds. Add a save -> clear -> reload -> resolve-save regression test.

### Medium: live asset updates can resurrect a deleted row

The live-update hook permits overlapping async flushes. An ingest flush awaits `fetchAssetById`; while it waits, a delete event starts a second flush and removes the row. When the first fetch resolves, it merges the stale asset back into state. The grid can therefore display an asset that the host has already deleted until a later reload.

Affected code: `packages/ui/src/features/asset-grid/react/hooks/useAssetGridLiveUpdates.ts:59-94`.

Fix direction: serialize flushes or associate each id with a monotonic event generation and discard a fetch result superseded by a delete. Add an in-flight-ingest followed by delete regression test.

### Medium: exclusive lock acquisition can fail during ordinary release

After `openSync(...O_EXCL...)` returns `EEXIST`, acquisition calls `statSync(lockPath)`. If the owner releases the lock between those two calls, `statSync` throws `ENOENT` and the store operation fails instead of retrying. This makes normal concurrent config writes intermittently fail.

Affected code: `packages/admin/src/server/composio/file-lock.ts:27-44`.

Fix direction: treat that `ENOENT` as a retry signal, or remove the unused `statSync`. Add a test for a lock disappearing between failed open and stat.

## Validation

- Agent-runtime provider guard, connection-test, and model-catalog suites: 180 tests passed.
- `@jini-ai/admin` typecheck and its current admin/server/UI suites: 295 tests passed.
- Direct source review covered the UI-hook paths. A root-level ad hoc Vitest invocation selected a non-jsdom configuration and is not treated as product test evidence.

The current suites do not cover the four interleaving/bypass cases above.
