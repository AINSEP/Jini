# P10 Jini SOL handoff

Base: `codex/b-p10bj`, `010c8cd874f709ffa2c61de0de4e1dde4f808aad`.
All work is uncommitted in the working tree. No tests, builds, installs, type-checks,
linters, mutation runs, or API baseline generation were run, per dispatch.
The named witnesses were written before each corresponding production edit.

## Completed design commits, in order

### 1. P10-E1.J-a — Strict environment schema helper

Proposed commit: `feat(core): add strict environment schema helper`

Files:

- `packages/core/src/config/__tests__/env-schema.test.ts` (new)
- `packages/core/src/config/env-schema.ts` (new)
- `packages/core/package.json`
- `.changeset/p10-e1-strict-env-schema.md` (new; core minor)

Witness: `reports every bad name without echoing its value`.
Mutations: `stop-at-first-error` loses required error lines;
`append-raw-value` breaks the exact message and value-absence assertions.
Three failing fields are supplied in reverse name order, including a parser that
throws its raw input. The witness also requires the aggregate to omit a cause.

Public addition: universal `@jini-ai/core/config/env-schema`, mapped to
`dist/config/env-schema.{js,d.ts}`. Tolerant parsing and its contracts are untouched.
Opus combine must generate the API baseline.

### 2. P10-M5.J — Description matching, wire projection, and read-only image guidance

Proposed commit: `feat(cms)!: project media descriptions and inject metadata write tool id`

Files:

- `packages/cms/src/media/__tests__/list-page-w2g.unit.test.ts`
- `packages/cms/src/admin-http/http/__tests__/media.test.ts`
- `packages/cms/src/media/site/__tests__/view-image-tool.test.ts` (new)
- `packages/cms/src/media/list-page.ts`
- `packages/core/src/contracts/site/cms-media.ts`
- `packages/cms/src/admin-http/http/media.ts`
- `packages/cms/src/media/site/view-image-tool.ts`
- `.changeset/p10-m5-media-description-projection.md` (new; core minor, CMS major)

Witnesses and mutations:

- `finds an asset by description alone without returning a private document`:
  `omit-description-from-haystack` loses the expected public asset.
- `admin media returns a stored description and omits a missing one`:
  `drop-description-from-dto` loses the exact stored description.
- `uses the injected metadata write id for read-only image guidance`: a nondefault
  `assets.save_metadata` ID must appear in both guidance sentences; restoring the
  hard-coded ID fails these assertions. The catalog still declares no side effects.

No new package export. The existing 2,000-character write bound is reused unchanged.
The changeset distinguishes the compatible DTO addition from the required, breaking
`mediaMetadataWriteToolId` argument on the catalog, registrations, and contributor.
Opus combine must generate the affected API baselines.

### 3. P10-C1.J — Fold the last two CLI definitions into folders

Proposed commit: `refactor(agent-runtime): fold OpenCode ACP and Vibe definitions into folders`

Files:

- `packages/agent-runtime/src/defs/__tests__/index.test.ts` (new)
- `packages/agent-runtime/src/defs/opencode-acp.ts` (deleted; moved)
- `packages/agent-runtime/src/defs/opencode-acp/index.ts` (new destination)
- `packages/agent-runtime/src/defs/vibe.ts` (deleted; moved)
- `packages/agent-runtime/src/defs/vibe/index.ts` (new destination)
- `packages/agent-runtime/src/defs/index.ts`
- `packages/agent-runtime/src/defs/__tests__/opencode-acp.test.ts`
- `packages/agent-runtime/src/defs/__tests__/vibe.test.ts`
- `packages/agent-runtime/docs/spec/api.spec.md`
- `.changeset/p10-c1-cli-def-folders.md` (new; agent-runtime patch)

Witness: `the defs catalog exports both OpenCode variants and Vibe`.
Mutation: `drop-acp-barrel-entry` removes the required catalog export.
The two definitions move verbatim except for the specified relative imports.
Existing cases are retained; only their moved-definition import paths change.
`vibe/executable.ts`, shared helpers, unrelated stale API rows, manifests, and API
baselines are untouched. Opus combine must record before/after defs suite counts
and confirm all existing cases still run; one catalog case was added.

Shared coordinator artifact: `COMMIT-PLAN.md` (this file).

## Stopped: P10-M1.J

No files changed for this sheet. Its required `.mov`/`.m4v` storage-suffix witnesses
conflict with the current blob-key contract:

- `packages/cms/src/media/blob-key.ts`, `computeBlobStorageKey`, returns
  `ws/${workspaceId}/blobs/${sha256.slice(0, 2)}/${sha256}` with no extension.
- `packages/cms/src/media/blob-store.memory.ts`, `put`, uses that key unchanged.
- `packages/cms/src/media/media-service.ts`, `claimUploadBlob`, passes only
  workspace ID, SHA-256, and bytes to storage, and persists its returned key.

There is no `.mov` or `.m4v` storage suffix to assert on this base. Making those
assertions pass requires a storage change outside the sheet. The sheet is stopped
without substituting a filename assertion or inventing a storage adapter.
Its four named mutation witnesses are therefore not added, and neither
`@jini-ai/core/contracts/site/media-upload-limits` nor the CMS re-export is delivered.
Coordinator must resolve the witness/storage-contract mismatch before resuming M1.

## Tovu handoff

- E2 may consume the new universal `@jini-ai/core/config/env-schema` subpath after
  the OPUS E1.J-b prerequisite.
- M5.T must cut over atomically with M5.J: pass
  `mediaMetadataWriteToolId: "media_update_metadata"` beside the read tool ID at
  every host catalog/contributor/registration call and update its fixtures.
  Tovu owns persistence, editing, and the no-write view-tool harness witnesses.
- No new M5 subpath is needed. No M1 policy subpath or CMS re-export is available
  from this work because M1 is stopped.

## OPUS sheets left untouched (all 18)

P10-E1.J-b, P10-E2.T, P10-M2.J, P10-M3.J, P10-M3.T, P10-M2.T,
P10-M4.J, P10-M5.T, P10-H1.J, P10-H2.J, P10-H2.T, P10-M4.T,
P10-H4.T, P10-H5.J, P10-H6.J, P10-M5.T2, P10-C2.J, P10-C2.T.

## Review and verification limits

Static architecture review: PASS for implemented scope. Core keeps a type-only
dependency on its existing environment contract; CMS imports no host code; image
view execution gains no writes or model calls; the CLI move introduces no forwarding
shells or new dependencies. No production host activation is claimed.

| Assessed unit | Disposition | Findings / direct witness | Cost |
| --- | --- | --- | --- |
| `defineEnvSchema` | Static review only | Named aggregate witness constructs the schema; success/freeze behavior awaits cloud verification | O(1) wrapper |
| `readEnv` | Static review only | Named witness checks aggregate order, parser exception redaction, and no cause; success/freeze behavior awaits cloud verification | O(n log n) plus parser work; O(n) retained values/failures |
| `listMediaPage` search addition | Static review only | Named description-only/public-scope witness | Existing scan/sort cost unchanged |
| `toAdminMediaResponse` projection | Static review only | Named present/absent description witness | O(1) |
| Image catalog and ID threading | Static review only | Nondefault ID catalog witness; host harness remains M5.T work | Existing costs unchanged |

Pre-completion review: requirements and complete diff re-read; all additions belong
to named sheets; no existing tests deleted or weakened; no unrelated formatting,
helpers, validation, fallbacks, or comments added. No runtime, mutation, coverage,
or red/green result is claimed. Self-validation is unrun because the dispatch
explicitly prohibits it here; the next cloud run owns execution.

Deletions: only the two old CLI definition paths, as required by the moves.
No additional cleanup deletions were needed after the diff review.
