# Roles administration port — 2026-10-03

Codex(Execution). Input: owner dispatch, the existing standalone identity screens, the live
host roles feature, identity core types/permissions/ports and server service contracts,
admin media prototype, public admin core/module, ui-kit README and DELIVERY, workspace
instructions and architecture chapters 13/14. SPEC.md version 1 has SHA-256
`1e65346c61ba60fc5db88631e81423f27d591bd790041f6cd3a9e353f3db3cd7`.

## Result and decisions

The independent user-management package owns one new composable roles implementation.
`roles({})` returns the exact descriptor object passed into `createAdmin`; its lazy page
and lazy tabs share one effect-owned controller and a private port scope. Inactive tabs
have no mounted content. React files use exactly pages/tabs/hooks/components/__tests__;
there is no admin React implementation dependency. Only public core/module is imported.
All controls use ui-kit/react facades, including the overridable destructive dialog.
No components are sealed. Confirmation handles are human-only by default.

The descriptor requires rolesApi and provides no new services; the controller is owned
by the mounted page and disposed on unmount or scope change. The Roles and Policies tabs
can be omitted individually using `createAdmin`'s `omit` option. Writes require role.manage
(or an unconstrained owner wildcard) and default to denied. Client grants are frozen per
scope. Reads have no invented permission string: existing authenticated server routes
remain the authority for read access, so the page can render read-only without write grants.
The host must supply its already-resolved unconstrained grants, not scoped permission rows.
Server authorization, issuer-clamp checks, reference checks, transactions and workspace
isolation are still required. The memory adapter tests these client/server boundaries;
it is a fake, not a production authorization service.

Role/policy create, inline rename, policy description editing, confirmed role/policy
deletion, inline permission listing, scoped permission grants and confirmed revocation
are ported. Built-in roles and built-in/frozen policies have no mutation controls.
Permission viewing remains available for read-only and immutable policies. List reads
refresh together; permission writes refresh only the current policy panel. Generations
protect both successful and failed stale reads, close/reopen transitions and newer drafts.
A completed save cannot dismiss another row's editor. A pending destructive write blocks
duplicate confirmation and dismissal, and captures an immutable target. Disposal aborts
requests and prevents state settlements. Error explanations preserve server code data,
including host error classes, rather than requiring a shared exception class.

## Source mapping and rationale

| Source | New owner |
| --- | --- |
| Existing src/react/roles/Roles.tsx and live host features/roles/Roles.tsx | react/pages/RolesPage, tabs/RolesTab and PoliciesTab, components/RoleRow, PolicyRow, PermissionPanel, DestructiveDialog |
| Both roles hook implementations; live host's September race fixes | controllers/roles.controller; react/hooks/RolesController and page/tab/panel hooks |
| Both roles/rules.ts files | rules.ts; menu props in tab hooks |
| Roles.hooks.tsx tab selection and live host tab rationale | roles.module; RolesPage.hooks |
| Existing roles/text.ts and live host English dictionary keys | messages.en; destructiveCopy and English presentation |
| Existing core/types, permissions, ports | Domain records reused directly; browser port in admin/ports |
| Live host lib/api roles/policies methods | adapters/http, matching all 11 route/method/body/envelope shapes |
| Admin media defineAdminModule and private lazy React/effect-owned-controller pattern | roles.module and RolesBinding/Controller hooks, using only public core/module |
| Existing users, members and auth screens/ports | Read for boundaries; left unchanged; user assignments remain with users |

All 157 source comments from both roles implementations, including every historical why
comment, are retained verbatim in SOURCE-RATIONALE.md. Applicable behavioral rationale
also accompanies the new controller, descriptor and shell. Historical references to
framework-specific query invalidation, translated keys, hidden headings, row menus and
icons remain in that archive when their original implementation was not reused.

## Host swap

After the coordinated workspace install/build and package release, the host can compose:

```tsx
import { Suspense } from 'react';
import { createAdmin } from '@jini-ai/admin/core/module';
import { roles } from '@jini-ai/user-management/admin/react';
import { createHttpRolesApi } from '@jini-ai/user-management/admin/adapters/http';
import { KitProvider } from '@jini-ai/ui-kit/react';

const feature = roles({});
const admin = createAdmin({
  modules: [feature],
  ports: { rolesApi: createHttpRolesApi({ transport, workspaceId }) },
}, { permissions: resolvedGrants });
const { Page, tabs } = feature.react.pages.roles;
const description = admin.describe().pages.find(page => page.id === 'roles.roles')!;

function RolesScreen() {
  return <KitProvider needs={[feature.kitNeeds]}>
    <feature.react.Provider admin={admin}>
      <Suspense fallback="Loading…"><Page tabs={tabs} description={description} /></Suspense>
    </feature.react.Provider>
  </KitProvider>;
}
```

The host supplies `transport`, `workspaceId` and `resolvedGrants`. Transport accepts named
`{path, method, body?}` and `{signal?}`, serializes body objects, attaches authentication,
adds its API prefix and rejects with the existing structured server errors. Default
paths start at `/workspaces/:workspaceId`; the optional `basePath` replaces `/workspaces`,
e.g. `/api/workspaces` if the transport takes complete API paths. IDs are URI-encoded.
No host URL, API key, cookie or global workspace is chosen by the package.

The descriptor route is `/roles`, for a host shell to prefix with its admin mount. The
Page accepts `requestedTab` and `onTabChange({tab})` for host routing; with neither it
owns selection locally. Unknown/omitted tab IDs fall back to the first visible tab.
To hide Policies: `createAdmin(..., { omit: ['roles.roles.policies'] })`.
Recreate the admin for a changed workspace/grant scope and dispose it when retiring it.
The provider/controller also handles a supplied API/grant scope replacement by dropping
old data and aborting old requests. Use a host-level KitProvider to share overrides when
integrating with the rest of the shell. No host source or routing was changed by this job.

## Unported behavior, cleanup and warnings

1. Cleanup (2026-10-03): deleted superseded `src/react/roles/**`, including its hook tests,
   and removed its value/type exports and legacy-only integration tests from `./react`.
   Source/type import searches across the engine and host found no external consumers; only
   the old barrel and its tests referenced those screens. Roles UI now lives exclusively
   in `./admin/react`. No alias or forwarding shim was added. Users, members and auth
   implementations remain unchanged; their shared role/policy DTOs and fake ports remain.
2. Users, members and auth retain their original standalone implementations. In particular,
   the legacy `./react` barrel still reaches optional admin React components through those
   existing screens. New `./admin*` code imports admin only through core/module; root and
   server closures remain independent. Removing legacy React/admin coupling requires that
   later screen migration, rather than a hidden rewrite in this roles job.
3. Locale dictionaries/translation injection, tab icons, host users navigation/link, exact
   table styling, visual heading hiding and product-specific agent handle plumbing are
   deferred. This slice uses English and native semantic tables; ui-kit has no Table facade
   yet. Stable row IDs are React keys. Host agent metadata can be injected into ui-kit;
   this job does not bind an agent runtime. Permission constraint JSON is displayed neither
   as an editor nor an interpreter, matching the source form's permission/resource scope.
4. Memory uses fake IDs, in-process maps, a permission catalog, unconstrained issuer grants
   and injected live-reference IDs. It does not persist data or implement real assignments,
   policy attachments, sessions, audits or database transaction isolation. Permission
   grants append distinct rows, matching the service. Production servers must enforce
   their full identity invariants independently. Conformance mutates and cleans up rows;
   run it only on an isolated disposable backend with management and catalog grants.
5. Cleanup (2026-10-03): coordinated pnpm installation now supplies the ui-kit workspace
   link and installed importer. Removed temporary package-local tsc paths and Vitest
   aliases; resolution uses ui-kit's public package exports. Admin had no matching mappings.
   This cleanup performed no install, build, staging, commit, publish or lockfile mutation.
   Existing lockfile changes belong to other jobs. The original port's process-list probe
   was denied by the sandbox and that job did not perform an install.
   The roles React tests now await async `act` for the lazy page and tab renders rather than
   polling unflushed React 19 Suspense work. No timeout was raised or component mocked.
   Vitest 2's CPU-derived minimum conflicted with `--maxWorkers=1`; `minWorkers: 1` keeps
   both the normal and requested serialized command usable without reducing normal maxima.
6. No live HTTP server, browser top-layer/focus trap, React 18 matrix, theme adapter or
   real host route was exercised. jsdom assertions establish render/action behavior only.
   Public export smoke uses a physical temporary package copy, not an npm installation.
   No claim is made that optional admin/React peers are unnecessary for their own entries.

Suggested next assignee: host integration/release owner for transport, route and grants,
then a separately scoped legacy-screen cleanup owner. No missing admin core API blocked
this port; identity-based scope binding was handled within user-management.

## Validation

All commands run from the engine workspace. The unchanged package baseline was green:
`pnpm --filter @jini-ai/user-management exec tsc --noEmit` (exit 0) and
`env -u TOVU_ADMIN_PASSWORD pnpm --filter @jini-ai/user-management exec vitest run`
(exit 0; 31 files, 313 tests).

Final command results are recorded below after the final run. The existing exact export
metadata tests were updated to nine entries and the browser classification includes
`./admin/react`; no assertion was weakened and no test was deleted or skipped. The
existing public-argument AST contract still checks every new exported function.

| Final command | Result |
| --- | --- |
| `pnpm --filter @jini-ai/user-management exec tsc --noEmit` | Exit 0; no diagnostics |
| `env -u TOVU_ADMIN_PASSWORD pnpm --filter @jini-ai/user-management exec vitest run src/admin` | Exit 0; 6 files, 22 tests passed |
| `env -u TOVU_ADMIN_PASSWORD pnpm --filter @jini-ai/user-management exec vitest run` | Exit 0; 37 files, 335 tests passed |
| `git diff --check -- packages/user-management` | Exit 0 |
| `pnpm --filter @jini-ai/user-management exec tsc --outDir /private/tmp/jini-roles-export-smoke/node_modules/@jini-ai/user-management/dist --declarationMap false --sourceMap false` | Exit 0; emission outside the repositories |
| `node /private/tmp/jini-roles-export-smoke/smoke.mjs` | Exit 0; 9 export targets present, 15 conformance checks passed without React, admin or ui-kit installed |

The scope covers 7 React tests, 6 controller tests, 4 memory security/error tests,
2 HTTP tests, 2 boundary tests and 1 conformance-runner test (15 behavioral checks).
Compile-only negative composition fixtures verify required ports, unknown ports and
unknown omitted tabs. Full-package count increased from 313 to 335; no existing tests
were removed. Baseline and final validation were independently run by Sidekick(Assist).
Final runs printed no warnings or failures. Intermediate failures were corrected in the
port (scope identity, asynchronous abort rejection, explicit argument types, omit option)
and the two now-outdated entry assertions, rather than bypassing tests.

## Every repository file created or modified

Created within packages/user-management (34):

- `src/admin/PORT.md`
- `src/admin/SOURCE-RATIONALE.md`
- `src/admin/SPEC.md`
- `src/admin/__tests__/boundaries.test.ts`
- `src/admin/__tests__/composition.typecheck.ts`
- `src/admin/__tests__/conformance.test.ts`
- `src/admin/__tests__/controllers.test.ts`
- `src/admin/__tests__/http.test.ts`
- `src/admin/__tests__/memory.test.ts`
- `src/admin/adapters/http.ts`
- `src/admin/adapters/memory.ts`
- `src/admin/conformance/index.ts`
- `src/admin/controllers/roles.controller.ts`
- `src/admin/index.ts`
- `src/admin/messages.en.ts`
- `src/admin/models.ts`
- `src/admin/ports.ts`
- `src/admin/react/__tests__/roles.test.tsx`
- `src/admin/react/components/DestructiveDialog.tsx`
- `src/admin/react/components/PermissionPanel.tsx`
- `src/admin/react/components/PolicyRow.tsx`
- `src/admin/react/components/RoleRow.tsx`
- `src/admin/react/hooks/PermissionPanel.hooks.ts`
- `src/admin/react/hooks/PoliciesTab.hooks.ts`
- `src/admin/react/hooks/RolesBinding.hooks.ts`
- `src/admin/react/hooks/RolesController.hooks.ts`
- `src/admin/react/hooks/RolesPage.hooks.ts`
- `src/admin/react/hooks/RolesTab.hooks.ts`
- `src/admin/react/index.ts`
- `src/admin/react/pages/RolesPage.tsx`
- `src/admin/react/tabs/PoliciesTab.tsx`
- `src/admin/react/tabs/RolesTab.tsx`
- `src/admin/roles.module.ts`
- `src/admin/rules.ts`

Modified within packages/user-management (5):

- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `src/__tests__/package-entries.test.ts`
- `src/__tests__/user-management-rename.contract.test.ts`

Job artifacts outside the package:

- Engine workspace: `ADS-memory/.local-artifacts/handoff/sidekick/admin-port-roles-baseline.md` — helper-owned baseline/final ledger.
- Host workspace: `ADS-memory/.local-artifacts/handoffs/2026-10-03-admin-port-roles.md` — requested completion handoff; sole host write.
- Temporary emitted package and physical smoke script: `/private/tmp/jini-roles-export-smoke/`.
- Temporary test logs: `/tmp/admin-port-roles-baseline-{tsc,vitest}.log`,
  `/tmp/admin-port-roles-final-{tsc,admin-vitest,full-vitest}.log`, and
  `/tmp/admin-port-roles-final2-{tsc,admin-vitest,full-vitest}.log`.

No git index/history or host application source was changed. No install, package link,
admin/ui-kit/other package mutation, publish or lockfile mutation was performed.

Final shared-tree status also showed modifications in existing
`src/server/__tests__/admin-crud-service.test.ts` and `src/server/__tests__/grant-service.test.ts`.
Those appeared during other work and were neither written nor reverted by this job;
they are excluded from the authored-file inventory above.

## Users, members and auth backup port — 2026-10-03

Owner dispatch is binding: this adds backup modules only. No host screens, routes, panels,
imports or adapters were edited or swapped, and no standalone `src/react/users`,
`src/react/members` or `src/react/auth` implementation was deleted. Prior Roles cleanup
above predates this task. Existing unrelated shared-tree modifications were preserved.

### Sources and implementation

| Source | New implementation |
| --- | --- |
| Live host `features/users/Users.tsx`, rules, i18n and tests; standalone users | `controllers/users.controller`, `people.rules`, `react/pages/UsersPage`, `tabs/UsersTab`, `components/UserRow` and `UsersConfirmation`, page/tab hooks |
| Live host users hooks and standalone users hooks | Combined list/caller loading, panel/draft generations, confirmed status/delete/reset, immediate enable, email and grants; self reset deep link in users controller |
| Both reset-password field hooks; live autofill and mismatch tests | Confirmation/reveal state in users controller and UsersTab hooks; all credential facades retain semantic autocomplete, including revealed fields |
| Live members view/rules/hooks/i18n/tests and standalone members | Members controller, page/tab/row/confirmation, independent list/detail generations and injected refresh port |
| Live login view/hook/i18n/tests and standalone login | Auth controller, LoginPage/AuthTab and hooks; host title/callback/initial username injection |
| Live users/members HTTP registrars and auth registrar | HTTP adapter factories preserving all route/method/body/envelope shapes; encoded workspace/row ids and host auth/API-prefix transport |
| Roles descriptor/private binding/effect-owned controllers/ui-kit needs | Three independent descriptors and `users({})`, `members({})`, `auth({})` composition factories |

PEOPLE-SOURCE-RATIONALE.md archives all 430 comments extracted from both source sets,
including tests and dictionaries, in source order. Product identity words in historical
comments are normalized to `host`; all why explanations are retained. Active rationale
also accompanies the new controllers and hooks. English messages preserve the relevant
live source strings; locale dictionaries are read but translation injection is deferred.
No new public subpath is necessary: the nine existing exports and `jini.entries` remain
unchanged. Root/server/admin closures remain free of React; admin descriptors import only
the public admin core/module entry. UI components import only ui-kit/react facades.

### Behavior and owner safety

User creation, email edits, role/policy assignment, immediate enable, confirmed disable,
confirmed delete-to-Trash, confirmed reset and self-reset deep link are present. Reset
confirmation compares both fields before writing; reveal states reset on every close/open.
Failed resets retain the draft, while failed disable/delete close and show the row error.
Self-reset notices explain that the caller must sign in again. Deleting removes the row on
refresh while the production server owns the actual Trash lifecycle and retention.

Member detail reads cache successful results; closing/reopening or switching invalidates
old failures and spinners. Injected member refresh reloads the list and invalidates detail
cache. Disable updates both list and detail from the write response. Resend is immediate,
per-row busy/error/notice tracked, with constant delivered:true response. There is no member
DELETE route: removal is disable-only. Login remains a form rendered before the authenticated
shell; duplicate submits are blocked and retiring the controller suppresses the host callback.

Ownership cannot be inferred from a built-in role name: custom policies can confer wildcard
ownership. `usersSafety` is therefore a required declared port. Its synchronous `ownerStatus`
returns owner/operator/unknown and provides `seededOwnerPrincipalId` (or null while unknown).
Unknown or a throwing resolver denies target writes. Only a caller with a resolved unconstrained
owner wildcard can modify an owner. The seeded owner's disable/delete are hidden, and its reset
is self-only. Deletion requires both user.manage and the server's canManageUserTrash flag, and
self-delete is hidden. The member.manage self-email exception is retained; member.manage alone
cannot change other operators' profiles, credentials, grants, status or deletion.

All port/controller writes still require server authorization, issuer clamps, seeded-owner and
last-owner protection, workspace isolation, session revocation and transactions. Client guards
are affordances, never a server security boundary. Scope grants are immutable. Replace the admin
and port scope when workspace/caller/grants/safety data changes, including after creating a user
whose owner classification has not yet resolved. Unknown new rows remain protected until resolved.
Memory adapters are isolated wire fakes: reads intentionally allow read-only test fixtures; they
are not production authorizers, hashers, session stores, audit repositories or Trash services.
Grant-content maps test issuer clamps and fail closed for unspecified contents in non-owner fakes.

### Later host integration and cleanup

The host keeps its current screens. For later integration, compose any subset of the descriptors:

```tsx
import { createAdmin } from '@jini-ai/admin/core/module';
import { users, members, auth } from '@jini-ai/user-management/admin/react';
import { createHttpUsersApi, createHttpMembersApi, createHttpAuthApi }
  from '@jini-ai/user-management/admin/adapters/http';

const usersFeature = users({});
const admin = createAdmin({
  modules: [usersFeature],
  ports: {
    usersApi: createHttpUsersApi({ transport, workspaceId }),
    usersSafety: authoritativeHostSafety,
  },
}, { permissions: resolvedUnconstrainedGrants });
```

Use feature.react.Provider with this admin and its lazy Page/tabs plus matching description,
inside Suspense and a host KitProvider with feature.kitNeeds. Users Page accepts
openOwnPasswordReset and onOwnPasswordResetClosed; the host callback owns navigation.
Members Page accepts a scoped refresh subscription. Auth Page requires onLogin({user}) and
optionally accepts title/initialUsername; it can be composed with empty grants before login.
Transport owns cookies/session storage, body serialization, errors and API prefix. Default
workspace paths begin `/workspaces/:workspaceId`; authPath defaults to `/auth` independently.
No HTTP ownership endpoint was invented: the later integration owner must supply an authoritative
owner-classification source. Safety can come from already-resolved host identity data or a server
capability projection; do not derive effective ownership from display names.

Unported behavior / cleanup:

1. Keep the three standalone src/react domain trees and their exports/tests until a separately
   authorized cleanup. This job adds no aliases or forwarding shims. After actual consumers
   migrate, delete the old implementations and remove their admin/ui/agentic imports together.
2. The host's built-in-admin trash-only affordance is intentionally stricter in this backup:
   trash authority alone does not enable deletion without user.manage. This preserves the owner's
   binding rule that member.manage alone cannot act on operators. Resolve this difference in the
   later host integration scope, without weakening owner classification.
3. The current ui-kit ConfirmDialog contract has no validation-disabled-confirm prop. Password
   mismatch/empty input is explained and synchronously blocks the actual reset write, including
   when a host overrides the dialog; the confirm action is visually enabled until the kit adds
   that public capability. Do not misuse pending to disable it: that would also prevent Cancel.
4. Localization, exact visual styling/table facade, icon glyphs, focus-autofocus details, the
   expandable password-help tooltip, and host agent handle wiring remain integration work.
   Password help is visible text here. No product identity or agent runtime is selected.
5. No browser focus trap/top-layer, real login cookie, email delivery, persistent Trash restore/
   purge, real host swap or npm install was exercised. Conformance mutates isolated test data;
   users created by it are trashed, members fixtures disabled, and successful login can create a
   production session if a real adapter is used. Run only on disposable authenticated hosts.
6. Existing Roles React tests used a zero-delay timer for each userEvent character. Their input
   driver now uses delay:null to avoid CPU-contention timeouts; all original assertions/events
   and seven tests remain. Tab clicks and lazy-import settlement now use separate awaited scopes rather than nesting
   userEvent inside act. Package Vitest schedules one worker on the shared CPU runner. No
   timeout, skip, test deletion or coverage exclusion was introduced.

Suggested next assignee: host integration owner for an authoritative usersSafety binding and
locale/navigation/session wiring, then a separately authorized standalone-screen cleanup owner.
Validation and authored-file inventory for this extension follow below.

### Authored-file inventory for this extension

Created (31), all under `packages/user-management/src/admin/`:

- `PEOPLE-SOURCE-RATIONALE.md`
- `users.module.ts`
- `members.module.ts`
- `auth.module.ts`
- `people.rules.ts`
- `controllers/controller-store.ts`
- `controllers/users.controller.ts`
- `controllers/members.controller.ts`
- `controllers/auth.controller.ts`
- `__tests__/people.fixtures.ts`
- `__tests__/people.controllers.test.ts`
- `__tests__/people.adapters.test.ts`
- `react/hooks/PeopleController.hooks.ts`
- `react/hooks/UsersBinding.hooks.ts`
- `react/hooks/UsersPage.hooks.ts`
- `react/hooks/UsersTab.hooks.ts`
- `react/hooks/MembersBinding.hooks.ts`
- `react/hooks/MembersPage.hooks.ts`
- `react/hooks/AuthBinding.hooks.ts`
- `react/hooks/LoginPage.hooks.ts`
- `react/pages/UsersPage.tsx`
- `react/pages/MembersPage.tsx`
- `react/pages/LoginPage.tsx`
- `react/tabs/UsersTab.tsx`
- `react/tabs/MembersTab.tsx`
- `react/tabs/AuthTab.tsx`
- `react/components/UserRow.tsx`
- `react/components/UsersConfirmation.tsx`
- `react/components/MemberRow.tsx`
- `react/components/MembersConfirmation.tsx`
- `react/__tests__/people.test.tsx`

Modified (13) under that same admin directory:

- `SPEC.md`
- `PORT.md`
- `models.ts`
- `ports.ts`
- `messages.en.ts`
- `index.ts`
- `adapters/http.ts`
- `adapters/memory.ts`
- `conformance/index.ts`
- `react/index.ts`
- `react/__tests__/roles.test.tsx`
- `__tests__/boundaries.test.ts`
- `__tests__/composition.typecheck.ts`

Also modified: `packages/user-management/vitest.config.ts` (one worker; existing deadlines,
coverage configuration and test assertions retained). No manifest or export metadata change
was needed. Every other pre-existing package/workspace modification belongs to earlier or
concurrent work and was neither authored nor reverted by this extension.

### Final validation for the backup extension

SPEC.md version 2 SHA-256: `f3aec2b5e2b06c349952b7d32c3e0fd1001797e16417c8d2d229a0563bbf7233`.
All commands ran from the engine workspace. Final scoped counts preserve every existing test:
admin 22 → 53 (+31), server 225 → 225, public contracts 7 → 7. Roles remains 7/7.

| Command | Exit | Evidence |
| --- | --- | --- |
| `pnpm --filter @jini-ai/user-management exec tsc --noEmit` | 0 | Final rerun after the final safety hardening; no diagnostics |
| `pnpm --filter @jini-ai/user-management exec vitest run src/admin` | 0 | 9 files, 53 tests |
| `env -u TOVU_ADMIN_PASSWORD pnpm --filter @jini-ai/user-management exec vitest run src/server` | 0 | 16 files, 225 tests |
| `pnpm --filter @jini-ai/user-management exec vitest run src/__tests__` | 0 | 4 files, 7 public-entry/argument tests |
| `pnpm exec node --import tsx -e "const { checkPackageLayers } = require('./scripts/check-package-layers.ts'); const violations = checkPackageLayers(); console.log(JSON.stringify({ count: violations.length, violations }, null, 2)); process.exit(violations.length ? 1 : 0);"` | 0 | count: 0, violations: [] |
| `git diff --check -- packages/user-management` | 0 | No whitespace diagnostics |

Sidekick independently ran the admin/server/public-contract commands and initial final typecheck;
the primary reran typecheck after the last owner-status and me() shape hardening. All final logs
have no warning/stderr/act/deprecation markers. These checks use current dependency outputs;
no other package was built, installed or modified. No index/history mutations or publishing.

Baseline typecheck was green, but the pre-existing Roles React tests timed out before input
timer scheduling was corrected (7 failures in the shared baseline, 2 in the isolated diagnosis).
Intermediate new HTTP testing caught synchronous abort throws; adapter helpers now reject
consistently through async transport methods. Intermediate React testing caught the trash-only
member.manage affordance; deletion now requires user.manage too. No failing test was skipped,
weakened, removed or excluded. The layer script exports a function without a reporting CLI;
the tsx CLI's IPC pipe was sandbox-denied (exit 1), and an ESM named import initially hit the
root CommonJS module classification (exit 1). Calling the actual exported check via Node's tsx
loader/require runs the same repository checker without that IPC side effect and reports zero.

Temporary artifacts are under `/private/tmp/admin-port-people-*` and
`/private/tmp/admin-port-users-members-auth-*`, including the helper ledger and exact logs.
Only the package paths in the inventory above were intentionally written in either repository.
No host handoff was written because the context/tool-call stop threshold was not reached and
the owner prohibits host writes during normal execution. Done: backup modules and scoped checks.
Remaining: only the explicitly deferred host swap, parity gaps and legacy cleanup listed above.
