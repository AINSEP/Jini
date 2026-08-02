# Ports

One generic admin capability per file: `AdminIdentityPort`, `AdminAuthPort`, `AdminMembersPort`,
`AdminMediaPort`, `AdminSettingsPort`, `AdminDatabasePort`, `AdminRecoveryPort`,
`AdminIntegrationsPort`, `AdminCommentsPort`, `AdminExtensionsPort`, `AdminAnalyticsPort`,
`AdminWorkspacePort`, `AdminSeoPort`, `AdminRedirectsPort`, `AdminMenusPort`, `AdminFormsPort`.
Types only — no `fetch` calls, no route-group factories. That is a later slice
(`createXRoutes(transport)` per port), built against these contracts.

## `execution` is intentionally not here

The reference implementation's admin has an "Execution mode" surface (local-CLI agent detection,
BYOK connection test/model discovery — `detectExecutionAgents`/`testExecutionConnection`/
`listExecutionModels`/`testExecutionAgent` in its own API client). It is not a twelfth port in this
directory because `@jini-ai/ui-core`'s `src/features/execution/ports.ts` already defines an
`ExecutionPort` covering the same shape (`detectLocalAgents`/`testConnection`/`listModels`/
`testAgent`) — the reference implementation's version is a re-derivation of that port that has
since drifted from it, not an independent capability. Adding a third definition here would make the
drift worse, not better.

Do not add an `execution.ts` to this directory. If `@jini-ai/admin` ever needs to expose execution
as part of its own port set, that should be a re-export or an alignment pass against
`ui-core`'s definition, not a fresh one written from the reference implementation's own API client
in isolation. (That package may be moving to `@jini-ai/ui/core` concurrently with this work — refer
to it by feature path and shape, not by a hard import from this package's `/core`, which must stay
dependency-free.)

## Widening a reference-implementation-specific string union: `T | (string & {})`

Every port is derived from exactly one reference implementation, so any string-literal union lifted
straight from its source is really "the values that implementation happens to use today," not a
closed vocabulary another host is bound by. Reach for this idiom whenever a union is specific to the
reference implementation rather than an external standard:

```ts
export type ExampleStatus = "active" | "disabled" | (string & {});
```

`(string & {})` widens the type to accept any string while `T |` keeps the known literals visible
for editor autocomplete — plain `string` alone would drop that. Keep a union CLOSED instead only
when it names something outside this codebase's control (a real web/HTTP standard — OpenGraph's
`og:type`, HTTP redirect status codes — see `seo.ts`/`redirects.ts` for worked examples of that
call) or is otherwise genuinely exhaustive by definition, not merely "everything the reference
implementation supports so far." State the open/closed call and its reason next to the type, the
way every port in this set does; don't leave a future reader to guess which kind a given union is.

This idiom was introduced in this port set by `seo.ts`, `redirects.ts`, `menus.ts`, and `forms.ts`
(SEO/redirects/menus/forms slice) — no earlier port needed it. Use it rather than inventing a
second widening convention.
