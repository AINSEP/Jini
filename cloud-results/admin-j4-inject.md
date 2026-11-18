# admin-j4-inject report (2026-11-18)

**Status: J4 React half DONE as injection (Jini + Tovu). JM1 NOT started: blocked by its own prerequisites (below).**
Not visually checked: no browser used. Markup and CSS are unchanged; the change is wiring (contexts, factory arguments, types).

## Branches / SHAs (new branch `wave4/admin-j4-inject` in both repos, base `origin/integ/merge-3-2026-11-18`, fast-forward pushes only, no `--no-verify`)
Jini (base `d37821a4`):
- `a91c24a5` test: characterize the eight domain module bindings (before any change)
- `854ec8e0` step 1: core states the module UI contract; admin implements it; re-export shells deleted
- `0b20fed5` step 2: the eight domain modules receive `bindReact`/`useController` through a grouped `ui` argument
- `7133c7f9` fix: the media picker carries the injected controller hook into the host overlay (failing test first)
- `ac174885` each domain react entry exports its controller context (for hosts that run domain hooks outside the module Provider)
- then this report commit
Tovu (base `2d82735a`):
- `dd00a977` module page/tab types from the core contract (pairs with Jini `854ec8e0`)
- `8bb5795a` the host injects `reactModuleUi` into every domain module (pairs with Jini `ac174885`)
- then this report commit
Cross-repo pairing: Tovu `dd00a977` is green against Jini `854ec8e0`; Tovu `8bb5795a` against Jini `ac174885`. Between Jini `0b20fed5` and Tovu `8bb5795a` Tovu stays on the earlier Jini (COMMON-ADMIN section 3/JM recipe rule).

## Design of the injection (owner answer 2026-11-17, J4: "INJECT, do not import")
**Contract (types only, renderer-free) in `@jini-ai/core/contracts/admin-module`** (`packages/core/src/contracts/admin-module.ts`, +52 lines):
- `TabViewProps` (moved from admin, unchanged shape).
- `ModulePageProps<Tab = unknown>`: the old admin shape with the tab component type as a parameter (core names no React type).
- `ModuleViews<M>` (one lazy loader per page and tab), `ModuleBinding<M, Page, Tab, Provider>` (what binding yields).
- `UseAdminController`: the `useController` signature (`(required: { create, dependencies }, optional?: { start }) => { controller, snapshot }`).
- `AdminModuleUi<Page, Tab, Provider>` = `{ bindReact(...): ModuleBinding<...>; useController: UseAdminController }`, the grouped "hooks/runtime prop". `bindReact` is declared with method syntax so the implementation may take the renderer's own context type for `context` (method parameters are bivariant); no cast.

**Implementation stays in `@jini-ai/admin`** (the package that owns it): `core/react/bind-react.ts` and `use-controller.ts` now type against the core contract (`LazyTabView` = the shell's lazy tab type); new `core/react/module-ui.ts` exports `reactModuleUi: AdminModuleUi<LazyPage, LazyTabView, ComponentType<{admin, children}>> = { bindReact, useController }`, whose assignment is the compile-time proof that admin implements the contract. `@jini-ai/admin/core/react` lists its names (`bindReact`, `useController`, `reactModuleUi`, types `LazyTabView`, `ReactViews`); the `export *` barrel is gone.

**Each domain module** (forms, seo, redirects, media, widgets, comments, agent-plugins, source-control) states and receives:
- factory: `forms<Page, Tab>({ ui }: { ui: ModuleUi<Page, Tab> }, options = {})` (seo/media/widgets add `ui` to their existing required object). `ModuleUi` is a one-line local alias of the core contract with the Provider fixed to `ComponentType<{ admin; children }>`; `Page`/`Tab` are inferred from the host's argument, so the host keeps precise React types. **No default** (the domains do not own the implementation; owner: "defaulted only where the package owns the default").
- binding: `ui.bindReact({ module, views }, { context: <Domain>PortsContext })`.
- hooks: `<Domain>ControllerContext` (`createContext<UseAdminController | null>(null)`) and `use<Domain>Controller` in the domain's existing `<Domain>Ports.hooks.ts`; it runs the injected hook and throws `AdminConfigError('Controller hook unavailable: <id>')` outside the module. The 29 hook call sites changed only `useController(` -> `use<Domain>Controller(` and their import. `use<Domain>Controller` is not a forwarder in the C4 sense: it resolves the injected hook from the module scope and fails loudly when none was injected.
- the factory's `Provider` supplies `ui.useController` (media, agent-plugins, source-control gained a Provider wrapper; the others nest one more context in their existing wrapper). The media picker, which the host's `OverlayHost` renders outside that Provider, wraps itself in the same context (`mediaPickerFactory`, commit `7133c7f9`).
- `<Domain>ControllerContext` is exported from each react entry (explicit names) for a host that runs domain hooks directly.
security and playground stay in admin (sheet: not moved) and keep importing admin's own `useController`/`bindReact`.

**Host wiring (Tovu)**: `createHost{Forms,Seo,Redirects,Comments,Widgets}Module` and `createHostAdminScope` (media) pass `ui: reactModuleUi` from `@jini-ai/admin/core/react`. `module-context.ts` takes `ModulePageProps` from core and exports `HostModulePage` so the host module types can instantiate the generic factories (`ReturnType<typeof forms<HostModulePage, LazyTabView>>`). `__measurements__/request-volume` (runs forms/redirects hooks outside the Provider) supplies the two controller contexts in its wrapper.

**Guard (L5)**: no domain folder imports `core/react/use-controller` or `core/react/bind-react` any more (`rg -n "core/react/(use-controller|bind-react)" packages/admin/src/{forms,seo,redirects,media,widgets,comments,agent-plugins,source-control} -g '!**/__tests__/**'` prints nothing). No injection-debt or exception entry was added; `pnpm guard` ok.

## Removed / changed public API (changeset `.changeset/core-admin-module-ui.md`, minor core + admin)
- `@jini-ai/admin/react/bind-react` and `@jini-ai/admin/react/use-controller` export entries and their re-export shells deleted (2 Jini test importers and 2 Tovu importers repointed).
- `ModulePageProps` / `TabViewProps` no longer exported by admin; import from `@jini-ai/core/contracts/admin-module` (34 admin files repointed).
- Domain factories now require `ui` (all callers: Tovu 6 production sites, 1 Tovu test, 17 Jini test files).

## Tests (C2, C6)
- Characterization first (`a91c24a5`): `core/react/__tests__/module-factories.characterization.unit.test.tsx`, 8 cases (page ids, tab ids, bound-module identity, Provider). GREEN on base; RED under the mutation "drop the seo `entries` tab" (1 failed / 7 passed), restored. After the change the only edit is passing `ui`.
- New behaviour (RED first): `core/react/__tests__/module-ui-injection.unit.test.tsx`, 24 cases (per domain: factory binds through the injected `bindReact`; `use<Domain>Controller` runs the injected hook with the caller's arguments; refuses without one). RED before `0b20fed5`: 24 failed / 24.
- Bug found by Tovu `media-swap` ("uses the promise picker..." could not find "Choose": `Controller hook unavailable: media`): failing Jini test first, `media/react/__tests__/media-picker-overlay.test.tsx`, RED (`Controller hook unavailable: media`) then GREEN with the fix. It uses the raw Testing Library render on purpose (see test notes).
- Test plumbing: the shared admin test scope `__tests__/fetch-query-support.ts` (which already plays the host for the admin kit) provides all eight controller contexts with admin's `useController`; tests outside that scope wrap their ports context explicitly (forms `harness.tsx`, `catalog-scope.tsx`, `use-form-fields-editor.hooks.unit.test.tsx`; media `embed-policy-scope.tsx`; widgets `fixtures/pages.tsx`; agent-plugins `agent-plugins-hooks.test.tsx`; source-control `providers-tab-hooks.test.tsx`; redirects `legacy-harness.ts`). **Classification delta for the JM move runs:** these 8 files now import admin's `core/react/use-controller.js` (test-only). In a move run they take the controller hook from `@jini-ai/admin/core/react` (test edges are advisory in `scripts/lib/injection-gate.ts`) or from an owner test fake of `UseAdminController`; that choice belongs to the move run.
- No test deleted, no matcher weakened, no `vi.mock` added. Counts: admin 245 files / 3,018 tests (base) -> 248 files / 3,051 tests at `ac174885`; ledger 3,018 + 8 + 24 + 1 = 3,051 (balances). Core 216 files / 3,074 tests at `ac174885`.

## Gates (command -> exit code). Node 24.22.3; `pnpm install --frozen-lockfile` 0; `pnpm --no-bail -r build` 0
Jini, BASE (unmodified tree): `pnpm guard` 0; `pnpm check:size` 0; `pnpm check:complexity` 0; `pnpm check:hooks` 0; `pnpm check:why-comments` 0 (after `git fetch origin refactor/terra`; first attempt exit 1 only because the ref was missing); admin `npx vitest run --maxWorkers=2 --minWorkers=1` 0 (245 / 3,018).
Jini, AFTER (`ac174885`): core build 0, admin build 0; `pnpm guard` 0; `pnpm check:size` 0 (139 debt entries; at `0b20fed5` it was exit 1, `media` 81 lines, fixed by `7133c7f9`); `pnpm check:complexity` 0; `pnpm check:hooks` 0; `pnpm check:why-comments` 0 (453 files checked, 170 lost blocks, all allow-listed, same as base); `tsc --noEmit -p packages/admin/tsconfig.json` 0; admin `npx vitest run --maxWorkers=2 --minWorkers=1` 0 (248 / 3,051); core same command 0 (216 / 3,074).
Limits (C8) on every non-test file created or changed (72 files; flat config with `complexity 10`, `sonarjs/cognitive-complexity 10`, `max-lines-per-function 50`, `max-lines 500`, inline config off): 3 findings, all pre-existing functions that did not grow (one identifier renamed per function): `useFormSubmissionDetail` 62, `useFormSubmissions` 66, `useFormsList` 66 lines.
C3: one dynamic import in the diff, the existing route-level `import('./components/MediaPicker.js')`, moved with `mediaPickerFactory`. C4: no `export *` added (one removed). C5: no mock added. C7: one cast in the diff, the existing `ports.mediaApi as MediaApiPort`, moved unchanged. C9: no `catch` added. C11: no debt file edited. C12: factories keep `(required, optional = {})`; `use<Domain>Controller(required, optional = {})`.
Tovu, BASE (linked to Jini base): `npm --prefix apps/admin run typecheck` 0; `npm run typecheck:tests` 0; `check:hooks` 0; `check:size` 0; `check:complexity` 0; `check:boundaries` 14 (BASE-RED: 14 errors, none under `apps/admin`).
Tovu, AFTER (`8bb5795a`, linked to Jini `ac174885`): typecheck 0; typecheck:tests 0; check:hooks 0; check:size 0; check:complexity 0; check:boundaries 14 (the sorted error lines are identical to base: no new line). Admin tests: `npm --prefix apps/admin run test -- src/integrations/jini-admin src/features/{forms,seo,redirects,widgets,comments,media} src/__measurements__` 59 files / 596 tests pass. Whole admin suite: TOVU_ALL.
Setup notes: Tovu `npm ci` (with scripts) fails before linking because its `prepare` builds `@tovu/contracts` against unlinked Jini; used `npm ci --ignore-scripts` (root + apps/admin), then `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`, then built contracts + sdk. Tovu stays linked locally only; no package.json or lockfile edited in either repo.

## What is now unblocked / JM status
- **J4: DONE** (pure half earlier in `@jini-ai/core/admin-runtime`; React half by injection here). The admin-j4.md "owner answer on the L5 conflict" item is closed; the rejected `admin-j4-react-half.patch` is superseded and must not be applied.
- **JM-pre OWNER-UNIT-REWRITE rewrites (all folders): unblocked** (they were held only on the J4 React half). Their target changes from "ui-kit pieces" to "the core contract + an injected controller hook" (see classification delta above).
- **JM1 (forms move): still BLOCKED**, not started. JM1-pre steps 1-3 and R1c/R2a are done (forms hook-debt keys 0, size keys 0, no `export *`), but the forms classification has INTEGRATION cases (`FormsModule` 2, `submissions-states` 4, admin-jm-pre.md) and the sheet says the move run does not start before xpkg G-TESTS's integration home exists; `packages/integration-tests` does not exist and creating it needs a new install, which the `minimumReleaseAge` lockfile trap forbids until 2026-11-19 (xpkg-r12b.md). JM3 is blocked the same way (media INTEGRATION 38 cases); JM2/JM4/JM5 still need their classification finalized (admin-jm-pre-2.md "Left").
- Sheet text to update for every JM move run (owner answer supersedes it): "each owner declares its own kit ... J4's core/ui-kit pieces" -> the owner keeps receiving `ui: AdminModuleUi` from the host; a moved folder imports `AdminModuleUi`/`ModulePageProps`/`TabViewProps`/`UseAdminController` from `@jini-ai/core/contracts/admin-module` only.

## Next step
1. On or after 2026-11-19: G-TESTS creates `packages/integration-tests`; then the forms OWNER-UNIT-REWRITE rewrites and the INTEGRATION split; then JM1 exactly as written (with the sheet update above).
2. No processes left running.
