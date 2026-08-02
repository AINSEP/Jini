# Ports

One generic admin capability per file: `AdminIdentityPort`, `AdminAuthPort`, `AdminMembersPort`,
`AdminMediaPort`, `AdminSettingsPort`, `AdminDatabasePort`, `AdminRecoveryPort`,
`AdminIntegrationsPort`, `AdminCommentsPort`, `AdminExtensionsPort`, `AdminAnalyticsPort`,
`AdminWorkspacePort`. Types only — no `fetch` calls, no route-group factories. That is a later
slice (`createXRoutes(transport)` per port), built against these contracts.

## `execution` is intentionally not here

Tovu's admin has an "Execution mode" surface (local-CLI agent detection, BYOK connection
test/model discovery — `detectExecutionAgents`/`testExecutionConnection`/`listExecutionModels`/
`testExecutionAgent` in `apps/admin/src/lib/api.ts`). It is not a twelfth port in this directory
because `@jini-ai/ui-core`'s `src/features/execution/ports.ts` already defines an `ExecutionPort`
covering the same shape (`detectLocalAgents`/`testConnection`/`listModels`/`testAgent`) — Tovu's
version is a re-derivation of that port that has since drifted from it, not an independent
capability. Adding a third definition here would make the drift worse, not better.

Do not add an `execution.ts` to this directory. If `@jini-ai/admin` ever needs to expose execution
as part of its own port set, that should be a re-export or an alignment pass against
`ui-core`'s definition, not a fresh one written from Tovu's `api.ts` in isolation. (That package may
be moving to `@jini-ai/ui/core` concurrently with this work — refer to it by feature path and
shape, not by a hard import from this package's `/core`, which must stay dependency-free.)
