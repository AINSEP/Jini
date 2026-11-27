# bugd-sec — Jini only

No commits, installs, builds, tests, typechecks or linters run in this dispatch.
The supplied design is the approved pattern and boundary checklist: callback-only
guards in Jini; existing unguarded flows unchanged; no binding logic or new exports.

## Completed design commits (working tree only, in design order)

1. 3a — fence hosted MCP callbacks against saved configuration.
   Tests first: store.memory.optimistic.test.ts and external-mcp-repo.sql.test.ts.
   Mutations: `memory-ignores-callback-basis` removes memory configuration guards;
   `sql-runtime-ignores-config-basis` removes runtime SQL version/created_at WHERE guards.
   Tovu follow-up: `drop-callback-state-basis`, `drop-callback-write-basis`,
   `cleanup-uses-current-row`, `host-runtime-drops-config-basis`,
   `return-pre-commit-version-from-self-configuration`; v2 AAD witness pins.
   Files:
   - packages/core/src/contracts/hosted-mcp/record.ts
   - packages/integrations/src/api-connections/hosted-mcp/contracts.ts
   - packages/integrations/src/api-connections/hosted-mcp/oauth-row-writes.ts
   - packages/integrations/src/api-connections/hosted-mcp/sign-in-flow.ts
   - packages/integrations/src/api-connections/hosted-mcp/sign-in-status.ts
   - packages/integrations/src/api-connections/hosted-mcp/sign-in.ts
   - packages/mcp/src/federation/hosted/store.memory.ts
   - packages/mcp/src/federation/hosted/external-mcp-repo.ts
   - packages/mcp/src/federation/hosted/external-mcp-repo.writes.ts
   - packages/mcp/src/federation/hosted/__tests__/store.memory.optimistic.test.ts
   - packages/mcp/src/federation/hosted/__tests__/external-mcp-repo.sql.test.ts
   - .changeset/fence-hosted-mcp-callback-config.md
2. 3c — show remote endpoint origin on access cards.
   Test first: external/__tests__/tool-registrations.test.ts.
   Mutation: `show-raw-endpoint-on-parse-failure` returns the original URL on parse failure.
   Tovu follow-up: `show-mcp-endpoint-path`, `bind-access-approval-to-display-origin`.
   Files:
   - packages/mcp/src/external/access-review.ts
   - packages/mcp/src/external/__tests__/tool-registrations.test.ts
   - .changeset/external-mcp-access-card-origin.md

## Status

Both Jini implementations and both changesets are written. No sheets stopped or skipped.
Tests were authored before production edits and remain unrun, as do the mutations.
The three affected files have 13 existing expanded cases plus 5 added cases (18 total by source
inspection; not an execution result). Existing tests were retained unchanged.

Static diff review covered all changed source and tests. Guards are checked before staging
inside queued/locked writes, and SQL also compares them in UPDATE WHERE clauses. Runtime writes
leave version alone. Only local callback success/cleanup opt into the guards. The callback retains
its pre-exchange row; DCR seals state against the committed version; redirect AAD has no v1 fallback.
The access display changes neither saved rows nor full-URL admission snapshots.

Architecture review: PASS by source inspection against the supplied design; no new exports,
dependencies, binding logic, versions, package metadata, migrations or theme changes. Only the
named private helpers remoteEndpointOrigin and writeCallbackCleanup were added. Runtime/type
verification is pending the coordinator's run; no pass/fail or coverage claims are made.

Deletions: removed the post-exchange requireOAuthRecord call and its obsolete two-line rationale,
as explicitly required by 3a. Final diff review found no unrelated additions to retain or delete.

Tovu half: add the listed OAuth/access witnesses, remove the duplicate OAuth test imports, update
the two redirect AAD pins to v2 with the actual saved createdAt/version, and retain the positive
DCR control. No new subpaths/exports or production binding changes are needed. No bumps or release
steps are authorized. COMMIT-PLAN.md is coordinator scratch and must remain uncommitted.
