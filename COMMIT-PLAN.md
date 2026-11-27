# w3-ext-w1 — Jini working-tree handoff

Base: `codex/w3-ext-w1j`, `fd06f45b12ae0516b0fc196f58d785eba4d3831e`.
Source: read-only Tovu Git objects at `bf1519bba7`; the live `/Users/la/Programming/Tovu` checkout is at `bdeb4ea69f99926f75d94fcb917eb89b1469a907` and does not match those source blobs. Jini architecture anchors were inspected on the dispatched head. No Tovu files or Git metadata were changed.

Implementation status below means code and the named tests were written, with tests written first. It does **not** mean verified green. No tests, mutation runs, builds, installs, type-checks, linters, API generators, commits or pushes were run. The coordinator owns commits and the cloud verification run.

## Ordered logical commits prepared

Each item includes its package manifest and `.changeset/w3-ext-w1-jNN.md`. Every changeset is minor. The lists below name all other files touched by that logical commit.

1. **J03 — Core declarations before consumers** (`core`, `db`).
   - `packages/core/src/contracts/site/database-introspection.ts`
   - `packages/core/src/contracts/site/external-mcp-tool-ports.ts`
   - `packages/core/src/contracts/site/__tests__/website-extraction-ports.test.ts`
   - `packages/db/src/recovery/drift.ts`
   - Only `packages/core/package.json` needs additions for this commit. The changeset covers both packages.
   - Pins: “absent OAuth is a valid non-OAuth tool dependency” → `require-oauth-for-every-tool`; “missing drift remains unknown, not in-sync” → `erase-unknown-drift`. These are declaration pins: the named mutations must also be checked with TypeScript/expectTypeOf compilation; runtime Vitest alone erases the types.
   - Agent-pause is omitted per X2; no agent-pause test or export was added.

2. **J04 — Database doubles and transfer store** (`db`).
   - `packages/db/src/site/repo.memory.ts`
   - `packages/db/src/site/__tests__/repo.memory.test.ts`
   - `packages/db/src/transfer/confirmation-ui.ts`
   - `packages/db/src/transfer/__tests__/confirmation-ui.test.ts`
   - `packages/db/src/transfer/destination-store.ts`
   - `packages/db/src/transfer/__tests__/destination-store.test.ts`
   - Pins: “resolving a migration clears only the tracked run” → `clear-different-run`; “replacement warning only for a replacement” → `always-warn`; “a non-default migrated singleton is readable” → `read-default-only`; “a run finishing after replacement cannot patch the replacement” → `patch-after-replacement`.
   - The memory destination store, process singleton, vault constructors, clock, persisted ID, normalization and host scope remain for T03. The Jini scope keeps null principal/provider/binding and a host owner key.

3. **J06 — Consent parsing and revision CAS** (`cookie-consent`).
   - `packages/cookie-consent/src/site/request.ts`
   - `packages/cookie-consent/src/site/revisions.repo.ts`
   - `packages/cookie-consent/src/site/__tests__/request.test.ts`
   - `packages/cookie-consent/src/site/__tests__/revisions.repo.test.ts`
   - Pins: “omission is not a nullable revision token” → `missing-token-means-null`; “competing publishes serialize and a public read never loads the draft” → `skip-expected-published`, `read-draft-on-public-path`.
   - Kysely `^0.29.6` is an optional peer and dev dependency, with optional-peer metadata/message. No DB package dependency was introduced. The SQL pin uses a serialized structural kernel and compiled Kysely statements; it is not a real-dialect integration test.

4. **J07 — Hosted MCP SQL owner** (`mcp`).
   - `packages/mcp/src/external/external-mcp-repo.ts`
   - `packages/mcp/src/external/external-mcp-repo.writes.ts` (private; no subpath)
   - `packages/mcp/src/external/__tests__/external-mcp-repo.sql.test.ts`
   - Pins: “a missed editor update rolls back staged envelopes” → `commit-staged-vault-on-write-miss`; “access update writes no credential columns” → `access-write-includes-oauth`; “only one OAuth refresh lease is acquired” → `lease-read-then-write`; “hydration never crosses workspaces” → `join-without-workspace`.
   - Kysely optional peer/dev metadata added. Canonical envelope helpers receive `vaultErrors`; the host supplies the same transaction-owning kernel and vault repo. Tests exercise repository behavior and compiled SQL with a scripted driver; real transaction/dialect races remain T06/cloud verification work.

5. **J08 — Identity SQL owner and permission list** (`user-management`).
   - `packages/user-management/src/identity/repo.ts`
   - `packages/user-management/src/identity/repo.authentication.ts`
   - `packages/user-management/src/identity/repo.authorization.ts`
   - `packages/user-management/src/identity/permission-list-tool.ts`
   - `packages/user-management/src/identity/__tests__/sql-identity.test.ts`
   - `packages/user-management/src/identity/__tests__/permission-list-tool.test.ts`
   - Pins: “stale saves cannot revive sessions or keys” → `overwrite-stored-revocation`; “authorization writes serialize with the workspace guard” → `drop-identity-workspace-lock`; “denial occurs before any lookup” → `read-policy-before-authorize`.
   - SQL entries receive `server` isolation mappings. Table names, the versioned-write callback and stored-revocation expression are host bindings. Tests use the already-declared better-sqlite3 dev dependency; the guard ordering pin uses a serialized kernel fixture.

6. **J11 — Form destination credential and publish ports** (`cms`).
   - `packages/cms/src/forms/destinations/connection-port.ts`
   - `packages/cms/src/forms/destinations/port.ts`
   - `packages/cms/src/forms/destinations/__tests__/ports.test.ts`
   - Pins: “a renamed label cannot leak a different credential” → `skip-post-open-id-compare`; “an unapproved adapter does not open a secret” → `check-works-for-after-open`; “form-less preview never creates a receiver key” → `provision-on-empty-preview`.
   - The existing Jini key-store module is untouched.

7. **J14 — Media provider credential tools** (`cms`).
   - `packages/cms/src/media/site-generation/provider-credential-save.ts`
   - `packages/cms/src/media/site-generation/providers-tools.ts`
   - `packages/cms/src/media/site-generation/__tests__/credential-tools.test.ts`
   - Pins: “a provider patch preserves concurrent unrelated rows and preserves the sealed record descriptor” → `use-stale-provider-map`; “abort after the lock prevents the save” → `drop-planner-abort-check`; “listing returns presence only” → `include-token-hint-in-list`.
   - Uses existing core `SurfaceCardSecretRun`/`SurfaceCardSecretSpec` from `contracts/cards`, not UI/daemon runtime imports. The host binds metadata reads, `saveProviders`, credential-free validation, localized copy/hints and `secureCard`. The bridge receives a bound `prep`, `save({ value, signal })`, result/outcome callbacks and the original handler options. `saveProviders` uses the review's literal two-object arity and generic D.

8. **J15 — Deploy kit mechanics** (`devops`).
   - `packages/devops/src/deploy/site/deploy-targets/host-kit.ts`
   - `packages/devops/src/deploy/site/deploy-targets/__tests__/host-kit.test.ts`
   - Pin: “caller abort identity wins and reachability closes on refusal” → `drop-caller-signal`, `close-only-on-success`.
   - Exports `DEPLOY_FETCH_TIMEOUTS`. DNS policy, validated transport creation, time/sleep, SigV4 construction and diagnostics wrappers stay host-bound. No changes to generic `deploy/host-kit.ts`; no static-renderer extraction (X3).

9. **J17 — Web screenshot catalog and registrar** (`diagnostics`).
   - `packages/diagnostics/src/web-evidence/web-screenshot/agent-tools.ts`
   - `packages/diagnostics/src/web-evidence/web-screenshot/tool-registrations.ts`
   - `packages/diagnostics/src/web-evidence/web-screenshot/__tests__/tool-registrations.test.ts`
   - Pin: “denied callers do not reach the service and both site factories share one service” → `screenshot-before-authorize`, `construct-service-per-build`.
   - Catalog limits use `maxUrlLength`, `maxFullPageHeightPx`, `maxWaitMs`, `defaultWaitMs`, `viewportNames`. Service/parser are injected; the two optional site factories retain their independent positional deps arguments.

10. **J18 — Web fetch registration** (`platform`).
    - `packages/platform/src/web/tool-registrations.ts`
    - `packages/platform/src/web/__tests__/tool-registrations.test.ts`
    - Pins: “deny causes no fetch and a site-specific client retains the contributor limiter” → `fetch-before-authorize`, `new-limiter-per-site`; “find can see a match beyond the output window” → `apply-output-limit-before-find`.
    - The host owns the entire ports bag and limiter; Jini only merges site overrides. `host` includes catalog, permission, catalogModule, fetchPage and the two shaping callbacks. Absent signal is omitted.

## Stopped / left

- **J01, J02, J16: REJECT**, left for their ext-crp/ext-w2 owners. No rejected exports or tests were created.
- **J05: STOP.** The required existing parser `packages/integrations/src/api-connections/declarations.ts:1` imports `node:path`. The proposed universal contribution entry would load it. The sheet does not authorize changing that owner, injecting the parser, or changing this entry to node. No J05 changes remain.
- **J09: STOP.** `packages/user-management/src/members/member-challenge-request.ts:3`, required by the moved registrar, imports `randomInt` from `node:crypto` (its auth helpers also own server behavior). This conflicts with the required universal entries. No injected sign-in-operation seam or relocation of that owner is sheeted. The J09 draft was removed rather than shipping a universal entry with this dependency; no J09 changes remain.
- **J10: STOP.** Both contributors require `publish/content/repo-handler.ts`, whose runtime dependency `packages/cms/src/publish/content/content-hash.ts:1` imports `node:crypto`. The navigation source additionally uses the normalizing `navigation/node` writer. The sheet provides neither a portable hash seam nor permission to change the classification/behavior. No J10 changes were made.
- **J12: STOP prerequisite.** Required ext-crp CRP-02.J has not landed: `packages/daemon/src/surface-exchanges/human-confirm.ts` is absent, and the new confirmation/grant types are not in the present core surface contract. No substitute lifecycle or CMS→chat edge was added.
- **J13: STOP prerequisite.** Its J01-bound approval builder has been superseded, while the replacement CRP-02 implementation is absent; no `approvalToolHandler`/`createHumanConfirmationKit` exists in this daemon tree. A replacement confirmation ABI was not invented. Capture-clear remains owned by ext-w2.
- No `BUILDER: OPUS` or `NEEDS-OPUS` build sheet is present in this Jini list. Every implemented sheet still needs the specified Opus review/mutations.
- All T01–T17 are outside this Jini-only dispatch; T01/T15 are also rejected. All six NOT-SHEETED candidates remain untouched.

## Tovu cutover and pending release work

Consume these new subpaths after the paired sources are reviewed:

| Pair | New subpaths |
| --- | --- |
| T02 | `@jini-ai/core/contracts/site/{database-introspection,external-mcp-tool-ports}`; preserve both host rationale blocks specified by T02. Agent-pause remains ext-crp-owned. |
| T03 | `@jini-ai/db/site/repo.memory`, `@jini-ai/db/transfer/{confirmation-ui,destination-store}`; bind vault kind/ID/clock, normalizeCredentialToken and memory singleton in destination-store-host. |
| T05 | `@jini-ai/cookie-consent/site/{request,revisions.repo}`; bind original path resolver and table names. |
| T06 | `@jini-ai/mcp/external/external-mcp-repo`; bind original transaction kernel, same-kernel vault repo, tables and vaultErrors. |
| T07 | `@jini-ai/user-management/identity/{repo,repo.authentication,repo.authorization,permission-list-tool}`; bind tables, OCC/revocation callbacks and policy. |
| T10 | `@jini-ai/cms/forms/destinations/{connection-port,port}`; keep credential, key-store and product-copy bindings in Tovu. |
| T13 | `@jini-ai/cms/media/site-generation/{provider-credential-save,providers-tools}`; use the exact generic saveProviders arity and secureCard bridge above. |
| T14 | `@jini-ai/devops/deploy/site/deploy-targets/host-kit`; bind per-call native fetch, guarded reachability, trace wrappers, AwsClient, time and sleep. Static renderer stays ext-w2-owned. |
| T16 | `@jini-ai/diagnostics/web-evidence/web-screenshot/{agent-tools,tool-registrations}`; create the real service once, bind the exact catalog/parser and independent site factories. |
| T17 | `@jini-ai/platform/web/tool-registrations`; create limiter/observer/clock once in host composition; retain host guarded transport and policy. |

All 20 subpaths have types/import/default exports and jini.entries classifications. No universal barrel was widened. Regenerate/review only `api-baseline/jini-ai__{core,db,cookie-consent,mcp,user-management,cms,devops,diagnostics,platform}.json`. No baseline JSON was edited here. Cloud/coordinator must update dependency installation/lock resolution for the two Kysely optional peers and run the named pins, mutations, package checks and guard before release/pinning. Tovu importer-ledger scans and source deletions belong to the T dispatch; no Tovu importers were changed here.

## Diff cleanup and audit

Removed during review: all seven authored J09 draft files (four modules, two test files and its changeset), its four proposed export/runtime entries; unrelated manifest formatting/Unicode rewrites and duplicate-key loss caused by initial serialization; unused introduced RawBuilder imports; one introduced explanatory comment; a duplicate vaultErrors property. No pre-existing tests were deleted or weakened. The only pre-existing production-source removal is the J03 relocation of SchemaSnapshot/DriftStatus, with existing db type exports preserved.

Manual boundary/statement-order review: staged vault rollback, access-only writes, SQL table binding, identity revocation/locks, transfer CAS, form credential guards, media planner abort/descriptor preservation, deploy cleanup, screenshot authorization and shared web ports were inspected. No new runtime host imports, raw-client fallback, crypto/vault implementation, theme code, permission/tool-ID changes, helper files or re-export shells were added. This document is the only handoff artifact added.

Architecture status: **WARNING / unverified** for prepared code; explicit blockers above for stopped sheets. Declaration pins need compilation; scripted SQL tests are not claims of real database concurrency coverage. Fresh runtime/type/guard/mutation evidence and API baselines remain pending because this dispatch prohibits running them. No green or coverage claim is made.
