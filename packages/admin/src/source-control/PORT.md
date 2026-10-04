# Source-control port — 2026-10-03

## Active spec and architecture (before implementation)

Owner admin-port-batch1 brief version 1.0.0 and continuation dispatch. Use the media/security
module, disposable store, bindReact, useController pattern; ui-kit only, all tabs lazy,
exactly one folder level in React. No framework in headless code and no cross-domain imports.

The source is a CONNECTION page. Git push, history, diff, branches, sync and content versioning
are not built in the source and are not invented here. Preserve descriptor order/fields,
required-field validation, default-credential selection (fallback first), create label default,
replacement retaining labels, independent row drafts and saves, optimistic summary update,
blank drafts after acceptance, unavailable providers retaining saved rows, native disclosure
group with first unconnected host open, visible Replace token action and Saved timestamp.
No secret reveal or liveness claim. Unknown errors must not echo submitted secrets.

Page/controller reads require source-control.read, writes additionally require
source-control.credentials.write, all default denied. Optional navigation is a host port
to the single named-credential management home; no Security implementation import.

## Acceptance contract

Memory/controller create vs replace, required fields, default selection, no-grants guards,
independent writes, duplicate click, secret clearing, late load/save after disposal and catalog
failure. Memory conformance validates CRUD, metadata-only updates, unique labels, default slots,
abort and immutable summaries. HTTP tests verify all paths, envelopes, bodies and abort signal.
React tests prove no-grants and read-only views plus successful save via ui-kit.

## Source mapping / host swap

SourceControl.tsx → page/hook; ProvidersTab.tsx → lazy tab and ProviderRow/fields components;
use-source-control-credentials.hooks.ts → controller; rules.ts → rules/models;
source-control-credentials-dependencies.hooks.ts + lib/api.ts → injected HTTP adapter.
Rationale comments from all domain source files are retained in SOURCE-RATIONALE.md with
product names generalized; active invariants remain inline.

Pass sourceControlApi and optional sourceControlNavigation; transport owns auth, error decoding
and HTTP serialization. workspacePath is `/api/admin/v1/workspaces/<id>` for the current host.
The server gates ALL verbs with source-control.credentials.write (including catalog/list), so
read-only frontend grants need an authorized server/host adapter. Frontend grants never replace
server authorization. Credentials remain encrypted/validated on the real server.

## Not yet ported / limits

No git operations exist to port. Reuse of a publish token was explicitly deferred in the source.
Host styling/icons/localization/deep-link replace navigation remain host-owned; onTabChange
is exposed by the binding. The source's raw validation detail is replaced by safe error copy.
No live HTTP backend, packed consumer, browser or encryption verification is claimed.

## Validation

Pending scoped commands; results/inventory will be appended.

## Final validation and complete inventory

Commands from `/Users/la/Programming/Jini`:

- `pnpm --filter @jini-ai/admin exec tsc --noEmit` — exit 0, no diagnostics.
- `env -u TOVU_ADMIN_PASSWORD pnpm --filter @jini-ai/admin exec vitest run src/source-control` — exit 0; 4 files / 18 tests (controllers 10, HTTP 2, rules 3, React 3), 2.61s.

Initial typecheck rejected unsupported kit autoComplete attrs and implicit test-transport
parameters. Corrected with forwarded refs in a hook and explicit parameter types; tests
keep exact autocomplete assertions. No ui-kit or security edits. Disposal scrubs drafts
before aborting; late saves cannot repopulate them. No skipped tests/config changes.

Brief SHA256: 75491ff8c01f3da8b680a791461028b0bc182fbcc5af597862d245553ae60469

Created:
- `packages/admin/src/source-control/PORT.md`
- `packages/admin/src/source-control/SOURCE-RATIONALE.md`
- `packages/admin/src/source-control/__tests__/controllers.test.ts`
- `packages/admin/src/source-control/__tests__/http.test.ts`
- `packages/admin/src/source-control/__tests__/rules.test.ts`
- `packages/admin/src/source-control/adapters/http.ts`
- `packages/admin/src/source-control/adapters/memory.ts`
- `packages/admin/src/source-control/conformance/source-control-api.conformance.ts`
- `packages/admin/src/source-control/controllers/source-control.controller.ts`
- `packages/admin/src/source-control/index.ts`
- `packages/admin/src/source-control/messages.en.ts`
- `packages/admin/src/source-control/models.ts`
- `packages/admin/src/source-control/ports.ts`
- `packages/admin/src/source-control/react/__tests__/source-control.test.tsx`
- `packages/admin/src/source-control/react/components/SourceControlCredentialFields.tsx`
- `packages/admin/src/source-control/react/components/SourceControlProviderRow.tsx`
- `packages/admin/src/source-control/react/hooks/ProvidersTab.hooks.ts`
- `packages/admin/src/source-control/react/hooks/SourceControlCredentialFields.hooks.ts`
- `packages/admin/src/source-control/react/hooks/SourceControlPage.hooks.ts`
- `packages/admin/src/source-control/react/hooks/SourceControlPorts.hooks.ts`
- `packages/admin/src/source-control/react/index.ts`
- `packages/admin/src/source-control/react/pages/SourceControlPage.tsx`
- `packages/admin/src/source-control/react/tabs/ProvidersTab.tsx`
- `packages/admin/src/source-control/rules.ts`
- `packages/admin/src/source-control/source-control.module.ts`
- `packages/admin/src/contracts/credential-management.ts`

Modified: `packages/admin/package.json` (five exports and matching jini.entries).
Suggested next assignee: host integration owner; next port domain is agent-plugins.

Independent helper verified the intermediate 17-test state (typecheck exit 0, Vitest exit 0);
primary final validation adds server-order preservation. Blank-token hint/disabled save matches
the source: leaving blank performs no write and keeps the stored token.
