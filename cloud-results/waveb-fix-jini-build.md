# Wave B Jini build/typecheck fix run

Branch `fix/wave-b-jini-build` (from integ/wave-b ab8711ed). Base compared: refactor/terra (b7666092).
Scope: every package except packages/chat and packages/daemon (another run owns them).

## Counts (pnpm --no-bail -r build / typecheck; guard)
| | build fails | typecheck fails | guard violations |
|---|---|---|---|
| refactor/terra (base) | 4 (daemon, desktop-host, ui, user-management) | 5 (those + neutral-host) | 132 |
| integ/wave-b before | 12 | 7 (incl. db, reference-web) | 153 |
| fix branch after | 3 (chat, daemon, reference-web) | 3 (chat, daemon, reference-web) | 122 |

All remaining failures are chat/daemon (out of scope) plus examples/reference-web, which fails only on chat exports (below).

## Per package
**NEW (wave B caused; absent on base):**
- capability-providers: blob test fake typed `Buffer`, core `Bytes` is `Uint8Array` (index.test.ts:28).
- http-kit: tests imported guardSameOrigin / validationError / statusForError / SseEvent / DEFAULT_MAX_QUEUED_SSE_EVENTS from local modules; C4 moved them to `@jini-ai/core/contracts/server`. Tests now import from the core owner (31 errors).
- plugins: host files used PluginRouteContribution/ToolContribution/WidgetContribution, HookPoints, DefinedPlugin, PluginSdk, PLUGIN_PROVIDER_CAPABILITY without importing them from core/contracts/plugin-sdk (24 errors).
- provider-plugins: otel-port.ts did not re-export ExporterFactory/TracerProviderFactory from contract.ts; tests import `@jini-ai/protocol/a2ui` with no dependency declared (added devDependency + lockfile).
- cms: forms test fixtures typed kernels as core `StorageKernel` but need db `KyselyKernel` (`execute`/`query`); fixtures now use `KyselyKernel` (11 errors).
- ui: provider-edges test mount lacked `applyTheme` (new core contract); fake-ui-kit `renderWithUiKit` needed a return annotation (TS2742).
- admin: kit `TabBarTab` lacked `handle`/`handleLabel` (added, changeset admin-kit-tabbar-handle); MediaRefField passed `extensionForMimeType` with the wrong arg shape.
- db: copy-order.test.ts:65 tuple destructure is `string|undefined` (typecheck only).
- Guard-only NEW (21): L3-undeclared-edge (provider-plugins and sqlite import `@jini-ai/core` without declaring it; declared as dependency), SI-domain x7 (declared shared isolation sources: core text + model-facing-tool-errors, platform system.ts, ui react/kit.tsx), HW1 platform/src/command.ts (direct `process.env.ComSpec` -> injectable default helper), injection-debt-stale (ledger shrunk by hand: 220 entries dropped, 20 counts lowered, none added).

**PRE-EXISTING (also on base), fixed:**
- desktop-host logging.ts:76/79 exactOptionalPropertyTypes (forward only given fields).
- user-management members.list-cursor.test.ts:28 (`calls[0]?.`).
- ui use-standing-draft-autosave tests :215/:231 (clearStandingDraft returns `{discarded}`).
- ui use-bounded-status-poll / use-optimistic-stored-value tests had no implementation (red-by-design "dedupe job 06" tests). Implemented both hooks to the tests' spec (10 tests pass); exported from panel-kit; changeset ui-panel-kit-poll-and-stored-value (patch). Worth a glance from the owner: this adds public API.
- examples/neutral-host credential-tools.test.ts:87/91 (host messages, `listChoices`, `use` result now match core ports).

**Left / out of scope:**
- examples/reference-web: AgentLab.tsx:7 `createDomPageDriver` missing from `@jini-ai/chat/react` and :167 `pageDriver` not in `FrontendSessionBridgeOptions`. Owned by the chat run; vite build fails on the same export. NEW (base passes).
- neutral-host `connect-plugin-host.test.ts` "moved plugin host provisions..." fails at runtime (assertion on step detail); not a build/typecheck error, not investigated.
- db: no build failure now (earlier check listed it; only the typecheck test error above).
- 122 guard violations remain; all but none are new vs base (comm of rule+file lists vs base shows 0 new).

## Design questions
None blocking. One judgment call: hook implementations for the two red ui tests (above) were written from the tests plus the Tovu copies; revert those two files if job 06 is meant to land elsewhere.

## Commits (branch fix/wave-b-jini-build, pushed)
6a51cb38 feat(ui): add useBoundedStatusPoll and useOptimisticStoredValue the dedupe characterization tests specify
6a616bab chore(scripts): shrink the injection debt ledger to what wave B left (220 dropped, 20 lowered, none added)
04eda755 fix(ui): declare the react kit as a shared isolation source
69c283b4 fix(platform): declare system.ts as a shared isolation source
cca4618d fix(core): declare the text and tool-error helpers as shared isolation sources
572dbf00 fix(platform): read the ambient ComSpec through an injectable default, not process.env directly
a737bb7e fix(provider-plugins,sqlite): declare the @jini-ai/core dependency their production imports use
65e6440d fix(neutral-host): credential-tools test host matches the credential-copy ports (messages, listChoices, use result)
d30c5fa0 fix(db): copy-order test types its edge endpoint pairs (noUncheckedIndexedAccess)
eb7deb10 fix(user-management): list-cursor test guards the first recorded call (noUncheckedIndexedAccess)
9badc647 fix(admin): kit TabBarTab carries agent handles; SEO media ref adapts the mime-extension helper's args
132a3bdf fix(ui): tests satisfy the chart mount contract, annotate renderWithUiKit, type clearStandingDraft result
ea60adcb fix(cms): forms test fixtures type their kernels as the db KyselyKernel that carries execute
f0e84406 fix(provider-plugins): re-export the OTel factory ports and declare the protocol dev dependency its tests import
2c3be00a fix(plugins): import plugin-sdk types the host files use from their core owner
5a44238a fix(http-kit): tests import moved server vocabulary from its core owner
d09bbef8 fix(capability-providers): blob fake stores Uint8Array to match the core Bytes contract
d9912983 fix(desktop-host): forward only given log fields under exactOptionalPropertyTypes
