# Security port — active spec and decisions

Owner dispatch: 2026-10-03 admin-port-batch1. Version 1.0.0.

## Spec and architecture before implementation

Use media's defineAdminModule/bindReact/useController pattern. Pure rules and disposable,
framework-free controllers; HTTP and memory adapters implement the same contract. Dependencies
enter as ports; every public operation receives required and optional objects. English only.
React uses ui-kit facades and overridable safety confirmations. No logic in TSX.

Preserve distinct publish/source-control/custom identities, descriptor-driven forms, multiple
named rows, duplicate label validation, legacy default labels as display-only, default-selection
and server promotion on deletion. Preserve custom category, URL, additional hosts, username
tri-state, metadata-only updates without resending a blank secret. Search and categories apply
to named and other stores together; totals remain global. Read failures preserve healthy stores.
Other credential writes serialize; whole-map media writes preserve sibling baseUrl/model.
Permissions default denied in pages, tabs and controllers; server authorization is mandatory.
Optional root-key port offers status, create-only generation, old-key import, preview and typed
START FRESH confirmation with consequences. Never rotate active keys or reveal saved material.
Draft secrets clear immediately after a successful write, including when refetch fails; errors
never echo server values or raw exception messages. Disposal aborts and ignores late settlements.

## Acceptance tests

Memory-backed controller create/rename/replace/default/remove, read-only guards, draft clearing,
disposal races; independent read failures; other-store serialization and map preservation;
root-key preview gating, import and recovery; memory conformance; HTTP wire routes/body/envelopes;
lazy React tabs and no-grants/read-only renders, overridable destructive confirmation.

## Source mapping

- AccessTokensTab, OtherCredentialsSection and use-access-tokens → access controller,
  AccessTokensTab and credential components/hooks.
- use-other-credentials → other controller and separate OtherCredentialsPort.
- SiteTokenTab, SiteTokenRecoveryCard, use-site-token/recovery → RootKeyTab and root-key controller.
- rules → models/rules; provider catalogs are host descriptors, never cross-domain imports.
- dependencies and lib/api → injected HTTP transport and adapters.
- Every source comment is retained in SOURCE-RATIONALE.md grouped by original file. Product names
  in those comments are generalized; comments for active invariants also accompany implementation.

## Host swap

Supply securityApi, optional otherCredentials and optional rootKey; inject authenticated
transport plus workspacePath (e.g. /api/admin/workspaces/<id>). Adapters keep existing route suffixes.
Root-key tab hides without its port or admin.security.tokens.manage. Page security.read must be
explicitly granted. Writes use system.publish, source-control.credentials.write,
custom-credentials.write; other stores use admin.assistant.manage, admin.integrations.manage.
Host supplies security({}, { rootKeyScopeNotice }) for its root-key storage policy; no cloud/filesystem assumption.

## Intentional differences / not yet ported

Saved-key reveal/clipboard is excluded by the binding owner security rule. Status uses fingerprints.
Localization dictionaries become English copy. Per-store deep links, host styling/icons, live content-refresh-bus
subscriptions and bespoke provider guidance localization are not ported; reload is explicit.
Other stores stay optional because not every host runs assistant/media/MCP services. No live server
or real browser validation is claimed. Memory is a fake and stores no secret material.

## Validation

Working directory: /Users/la/Programming/Jini.

- `pnpm --filter @jini-ai/admin exec tsc --noEmit` — exit 0, no diagnostics.
- `env -u TOVU_ADMIN_PASSWORD pnpm --filter @jini-ai/admin exec vitest run src/security` — exit 0;
  4 files / 25 tests passed (HTTP 6, rules 3, controllers 10, React 6), duration 8.81s.
- Baseline before edits: same typecheck exit 0; `env -u TOVU_ADMIN_PASSWORD pnpm --filter
  @jini-ai/admin exec vitest run src/core/module src/media` — exit 0, 5 files / 24 tests.

A validation helper independently ran an intermediate green security check (3 files / 20 tests).
The final 25-test run adds username tri-state, descriptor validation, identity separation,
serialization and failed-preview coverage. No weakened assertions, skipped tests or config changes.
No live HTTP server, packed package, full workspace suite, or real browser check was run.

No installation was run. A local symlink `packages/admin/node_modules/@jini-ai/ui-kit` points to
`../../../ui-kit` and uses its existing build. ui-kit exports already had dist declarations/JS.
The lockfile was not edited: baseline and final shared diff both show 194 insertions / 16 deletions.
A workspace owner must coordinate the lockfile update for the new hard dependency before release.

## Complete file inventory

Created this domain's 28 files:
- `packages/admin/src/security/PORT.md`
- `packages/admin/src/security/SOURCE-RATIONALE.md`
- `packages/admin/src/security/__tests__/controllers.test.ts`
- `packages/admin/src/security/__tests__/http.test.ts`
- `packages/admin/src/security/__tests__/rules.test.ts`
- `packages/admin/src/security/adapters/http.ts`
- `packages/admin/src/security/adapters/memory.ts`
- `packages/admin/src/security/conformance/security-api.conformance.ts`
- `packages/admin/src/security/controllers/access-tokens.controller.ts`
- `packages/admin/src/security/controllers/other-credentials.controller.ts`
- `packages/admin/src/security/controllers/root-key.controller.ts`
- `packages/admin/src/security/index.ts`
- `packages/admin/src/security/messages.en.ts`
- `packages/admin/src/security/models.ts`
- `packages/admin/src/security/ports.ts`
- `packages/admin/src/security/react/__tests__/security.test.tsx`
- `packages/admin/src/security/react/components/CredentialEditor.tsx`
- `packages/admin/src/security/react/hooks/AccessTokensTab.hooks.ts`
- `packages/admin/src/security/react/hooks/CredentialEditor.hooks.ts`
- `packages/admin/src/security/react/hooks/RootKeyTab.hooks.ts`
- `packages/admin/src/security/react/hooks/SecurityPage.hooks.ts`
- `packages/admin/src/security/react/hooks/SecurityPorts.hooks.ts`
- `packages/admin/src/security/react/index.ts`
- `packages/admin/src/security/react/pages/SecurityPage.tsx`
- `packages/admin/src/security/react/tabs/AccessTokensTab.tsx`
- `packages/admin/src/security/react/tabs/RootKeyTab.tsx`
- `packages/admin/src/security/rules.ts`
- `packages/admin/src/security/security.module.ts`

Modified `packages/admin/package.json`: added ui-kit dependency and five security exports with
matching jini.entries; preserved pre-existing media exports and optional React peer declarations.
Local setup adds only the node_modules symlink described above. Domain comments are retained in
SOURCE-RATIONALE.md; inline comments accompany active security invariants.

