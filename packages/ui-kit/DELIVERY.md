# UI-kit v1 delivery — 2026-10-03

Implemented `@jini-ai/ui-kit` at package version **0.1.0**, with independent **KIT_CONTRACT 1.0.0**. All requested v1 source and validation gates are complete. No commit, git add, push, publish, or consumer migration was performed.

## Inputs and decisions

Read the owner-approved consensus-report.md and complete r5-opus/r5-sonnet/r5-codex designs from the supplied consensus run; inspected admin's provisional kit and ConfirmDialog markup/hooks; consulted governing workspace instructions and architecture chapters 13/14. Local graph evidence did not include the fresh provisional kit, and callable MCP graph tools were unavailable, so supplied source paths were read directly. A documentation helper loaded the Jini sidekick instructions and authored README/spec/decision documentation; source and safety decisions remained with the primary agent. The helper used the inherited model because Sonnet was unavailable.

This package adds no runtime dependencies. React, react-dom and Vue are optional peers plus devDependencies. The root imports no framework. Public operations and injected event ports use required and optional objects; native React callback signatures are framework-mandated exceptions. Zero-argument host callbacks remain assignable when they need no event data.

React facades share one global Symbol.for context, warn on development package-version skew, and use native defaults without a provider. Every slot is overridable. Partial extension preserves override provenance, strict creation requires every implemented slot, and description reports defaults, guard fallback and violations. Agent metadata is injected; no agent-runtime or other UI/admin package is imported.

ConfirmDialog views receive only guarded commands and prop bags. Pending/executing blocks every dismissal and duplicate confirmation; current policy is reread for stale handlers; direct agent execution checks permission. Cancel receives initial focus and closed dialogs restore the trigger. Human-only confirmation withholds the confirm agent handle. Consequences reach accessible labels and visible text. Rejected async actions show generic/host-provided error copy. A development guard inspects real mounted DOM and falls back to the native frame and actions; warn/off remain host choices. Production does not run the guard.

Select remains an HTMLSelectElement. Native implementations provide labelled fields, keyboard Tabs/Menu, focus/hover Tooltip, semantic Notice/Spinner/Badge, dialogs and an instance-local toast service with an explicit ToastRegion. Owned toast services survive StrictMode effect replay and dispose after real unmount. Native CSS is opt-in, scoped to parts under @layer jini.kit. No logic lives in implementation .tsx files.

## Executed validation

Commands ran from `/Users/la/Programming/Jini`:

| Command | Final result |
|---|---|
| `pnpm --filter @jini-ai/ui-kit exec tsc --noEmit` | Exit 0, including strict missing-component and spec/React prop-key type tests |
| `pnpm --filter @jini-ai/ui-kit exec vitest run --reporter=dot` | Exit 0: **4 files, 27 tests passed** |
| `pnpm --filter @jini-ai/ui-kit run test:headless` | Exit 0; builds with tsc and runs a physical-copy Node fixture with no React, react-dom or Vue installed |
| `pnpm --filter @jini-ai/ui-kit run build` | Exit 0 as the smoke command's build step |

Exact layer-checker invocation (the tsx CLI's IPC socket is blocked in this sandbox, so Node loads tsx directly):

```sh
node --import tsx --input-type=module -e "const m=await import('./scripts/check-package-layers.ts'); const v=(m.default??m).checkPackageLayers({repoRoot:process.cwd()}); console.log(JSON.stringify(v)); process.exitCode=v.length?1:0"
```

Result: exit 0, `[]` violations. No exemption was added; ui-kit is L1.

The native conformance run verifies **21 non-browser scenarios**, with all 16 components represented. **Two browser-only scenarios** (real native Escape and modal focus) are explicitly reported skipped by the React driver. The driver mounts with guard off so fallback cannot conceal broken adapters. Additional tests cover partial Button override flowing into ConfirmDialog, guarded commands exposed to an override, broken ConfirmDialog and Button fallback, guard off/production behavior, independent context-module evaluation, async failure/retry, trigger restoration, StrictMode toast lifetime, native form events and keyboard navigation.

No browser runner, MUI/shadcn adapter or cross-consumer integration was exercised. The headless smoke is a real Node import of the framework-free export from a physically copied built package, not a workspace symlink. It asserts all three frameworks cannot be resolved before import.

## Files and stubs

Every authored file, generated build file and local dependency link is listed in [FILES.md](FILES.md). The sole external source edit adds `'ui-kit': 1` to `scripts/check-package-layers.ts`. Workspace `packages/*` already discovers this package; no workspace-list edit is required.

Implemented components: Button, IconButton, TextField, TextArea, Select, Checkbox, Switch, Dialog, ConfirmDialog, Tabs, Menu, Toast, Tooltip, Notice, Spinner, Badge.

**Runtime stubs: none.** Planned metadata only: Link, Icon, RadioGroup, Field, Card, Table, Popover, Combobox, Stack, Grid, ShellLayout, Sidebar, NavItem, PageHeader, Section, EmptyState, OverlayHost. These cannot be requested with needs() and have no facade exports. Overlay/provider utilities already work independently of the planned OverlayHost component.

Vue/Angular bindings, library adapters, theme/motif loading and consumer migration remain intentionally deferred. The exported browser-driver port is implemented; an actual browser driver is future work, not a fake success stub.

## Setup, shared-tree and warnings

The pre-edit oauth typecheck was green. The pre-edit layer baseline could not be executed with the tsx CLI because it hit an EPERM IPC socket error; the layer checker passed after switching to Node's tsx loader. Do not describe the entire pre-existing workspace as a green baseline: this job never ran a whole-workspace baseline.

The required `pgrep -f "pnpm install"` probe failed with `sysmond service not found` / `Cannot get process list`. Therefore **no pnpm install or lockfile write was performed**. Package-local links point to existing installed workspace devDependencies, enabling scoped checks without racing an install. Vue is declared for development but was not needed by these tests.

At the final snapshot, the shared `pnpm-lock.yaml` diff was **16 insertions / 16 deletions**, all in the chat importer: previously hard MCP/Radix/recharts dependencies moved to its devDependencies. That is another job's work. It contains no ui-kit importer. Do not revert or attribute that diff to ui-kit. A coordinated install must add the new importer before relying on frozen-lockfile CI. Unrelated admin/devops/server/sqlite/chat/ui work was not edited by this job.

Known validation limits: real browser top-layer, focus trapping and geometry need a browser driver; the development guard checks computed visibility, metadata and semantics but is not a hostile-JavaScript sandbox. Action authorization remains with the host's injected operation. Package version and context warning version must be bumped together on release. No package was published.

## Remaining steps / suggested next assignees

1. **Workspace/release owner:** from a host where the process list works, wait until `pgrep -f "pnpm install"` prints nothing, then run the coordinated workspace install to add ui-kit to the lockfile. Review only the intended importer changes. Set up its npm Trusted Publisher before eventual publication.
2. **Admin migration owner:** after the provisional media work lands, replace provisional kit/ConfirmDialog implementations with direct ui-kit imports and one provider. Translate agent/overlay/cancel-label wiring to ports, update requirements and remove superseded code in that migration. No forwarding shims. Leave unrelated panel-kit/query/i18n logic with a separately designed owner.
3. **User-management migration owner:** adapt standalone screens in place to facades, declare needs, and keep the package independent. Admin composition uses its own optional composition entry rather than moving identity logic into admin.
4. **Chat migration owner:** switch controls to facades and inject agent/toast wiring. Treat pickers and heavy UI integrations as separate feature seams; a component kit alone does not untangle those imports.
5. **UI migration owner:** convert feature chrome to facades and keep feature logic/heavy adapters in ui. Build host-specific rich/MUI/shadcn implementations without making ui-kit depend on them; every Select adapter retains native semantics.
6. **Browser conformance owner:** implement a real driver for the tagged cases and extend it for focus trapping/restoration, layout visibility and synchronized Select. Run all host kits with fallback disabled, then prove one provider/override across migrated packages and duplicated package copies.
7. **Future framework owner:** fund Vue/Angular subpaths against the same root spec/rules/scenario data when a consumer needs them. Expand planned components only with native behavior and conformance coverage.

## Active implementation specs

All five specs are version 1.0.0. Hashes cover each document body after its metadata header:

- `api.spec.md`: Hash: sha256:54f76f0cbdeee7b584e4afb9bb0c5a05446efe351a25db210b467610c0723e81
- `behavior.spec.md`: Hash: sha256:782897964f3356bc26f737eaa2be50dcd68cd3258d8a7802990211ae09e79cb5
- `errors.spec.md`: Hash: sha256:5bd54392775eefa59554cb54e724b629ab7e60bcbc33c44b4317d4de01786fd9
- `state.spec.md`: Hash: sha256:da582ff8b4eb325d546c0abf1bc4e497612350cc83a39ed6cf9f527ab9e12c73
- `ui.spec.md`: Hash: sha256:d216284ad80f3e37d8d728888a5edece24bbf0c4a64bc8567518e5b05f683be4
