/**
 * Archived provenance rationale:
 * ### Design decisions worth flagging
 *
 * - **`title`/`detail` are host-supplied, not computed from a status+kind
 *   lookup table.** Both source cards hardcode branded, kind-specific copy
 *   ("Open Design is rebuilding tokens", "Workspace update ready" — see the
 *   purity-grep note below for why that exact text can't even appear in this
 *   package's comments). Baking any "kind"-aware copy-selection logic into the
 *   generic component would just re-embed OD's product vocabulary (job
 *   "kind" — generation/revision/token-contract-rebuild — is OD-specific)
 *   under a different name. The generic component instead takes optional
 *   `title`/`detail` and falls back to a neutral, status-only default
 *   (`Queued`/`Running`/`Complete`/`Needs attention`) when omitted. Computing
 *   richer, kind-aware copy is left to the host.
 * - **`progress: number | 'indeterminate'`** — neither source occurrence ever
 *   actually produces an indeterminate state (both always compute a 0-100
 *   percentage). It's included anyway because the task's own required test
 *   matrix asked for indeterminate-vs-determinate coverage, and because it's
 *   a natural, forward-looking capability for Jini's own Run/Agent/Tool
 *   dashboards (an agent step with no known total duration) — this is a
 *   deliberate generalization beyond what the two source cards themselves
 *   needed, called out here rather than silently added.
 * - **Per-item `label` values are not run through `useT()`.** `steps[]`/
 *   `secondaryItems[]` mix genuinely dynamic content (a todo's own text, an
 *   agent-touched file path) with the reference adapter's static fallback
 *   step titles, indistinguishably once they're both just strings in the same
 *   array — there's no way for the component to tell them apart. This matches
 *   the precedent already set by `ConnectorCard` not wrapping `connector.name`/
 *   `connector.category`. What *is* wrapped in `t()`, and covered by a real
 *   `I18nProvider` test: the fallback title/detail, the progress-bar
 *   `aria-label`, and the default "Files touched" secondary-items heading.
 * - **Adapters take a `*Like` structural input, not real `@open-design/contracts`
 *   types.** The task's own framing allowed shipping these as "documented
 *   reference adapters" for OD-shaped input; going one step further, the
 *   input types are locally declared minimal structural subsets rather than
 *   actual imports of an external, unvendored package — this package has zero
 *   dependency on `@open-design/contracts`, and a host whose real types are a
 *   structural superset can pass them in directly (TypeScript structural
 *   typing).
 * - **Slicing (`maxSteps`/`maxSecondaryItems`) moved from the adapter to the
 *   component.** The source cards slice at render time (`todos.slice(0, 6)`,
 *   `fileOps.slice(0, 5)`) inside the component itself. The adapters here
 *   return the *full* derived list; `ProgressCard` truncates for display via
 *   props (defaulting to the same 6/5 caps). This keeps the adapter's output
 *   data-complete and makes the truncation a generic, overridable view
 *   concern rather than something baked into one specific adapter.
 * - **No orchestrator hook was needed.** Unlike the connectors canary
 *   (`useConnectorCatalog`/`useConnectorAuthorization`/`useConnectorDetail`),
 *   this feature has no live data-fetching or async state of its own —
 *   `ProgressCard` is purely presentational, and the adapters are synchronous
 *   pure functions. There is deliberately no `ports.ts`/`dependencies.ts`
 *   pair in this feature; a host wires its own data source directly into
 *   `ProgressCardData` (via these adapters or its own mapping) rather than
 *   this package owning any transport.
 *
 * ### Dropped, and why
 *
 * - **The Bash `rm`-command detection heuristic** from the source
 *   `deriveFileOps` (`extractSimpleBashDeletes`/`shellWords`/
 *   `isShellSeparator`/`isRedirectionOperator`/`looksUnsafeForFileList`, ~100
 *   lines) — a self-contained shell-command tokenizer used only to detect
 *   file deletions performed via a raw `Bash` tool call rather than a
 *   dedicated `Delete`-family tool. This is a distinct, non-trivial parsing
 *   concern in its own right, not core to "progress bar + status icon + step
 *   list," and isn't mentioned anywhere in r6 §1.5 or the plan doc's item 2.
 *   `deriveFileOpsFromAgentEvents` keeps the tool-name-based classification
 *   (`Read`/`Write`/`Edit`/`MultiEdit`/`Delete`/etc., which covers the large
 *   majority of real file-op tool calls) and drops only the Bash-string
 *   heuristic. A future task adopting this as a real extraction target should
 *   do so as its own item, not bundled here.
 * - **`job.kind`** (`generation`/`revision`/`token-contract-rebuild`) was not
 *   carried into `DesignSystemGenerationJobLike`/`ProgressCardData` at all —
 *   it exists purely to drive the OD-branded, kind-specific copy the generic
 *   title/detail design above already excludes. A host that wants
 *   kind-specific text computes it itself before calling the adapter and
 *   overrides `title`/`detail` on the result.
 * - **`todo.activeForm`** (an alternate in-progress-tense label OD's todo
 *   schema carries) — not used by either card's actual rendering, so not
 *   carried into `TodoItemLike`.
 * - **CSS class names were not ported verbatim** (`ds-workspace-activity-card`,
 *   `ds-generation-review-card`, `ds-generation-review-progress`, etc.) — new,
 *   neutral names were used (`progress-card`, `progress-card-bar`,
 *   `progress-card-steps`, `progress-card-secondary-items`) since the
 *   original classes are tied to OD's own stylesheet, not shipped here.
 *
 * ### Post-merge audit pass (2026-07-17): a real bug fix, a dead-code removal, and 100% coverage
 *
 * A follow-up audit re-diffed every in-scope piece above against the vendored
 * original function-by-function and found the port faithful — every
 * generification already listed in this section checked out against the
 * original's actual behavior. The audit did surface two real issues once
 * branch-coverage was wired up (`@vitest/coverage-v8`, run via a scoped CLI
 * include/exclude filter — `--coverage.include='src/features/browser-chrome/**'`
 * — rather than a shared `vitest.config.ts` change, so the rest of the package's
 * test config is untouched):
 *
 * - **Real bug, fixed** — `rules.ts`'s `recordNavigation` hardcoded
 *   `DEFAULT_HOME_NAVIGATION_ENTRY.title` ("New Tab") for a navigation to
 *   `EMPTY_URL`, ignoring a caller-supplied `options.homeLabel`. Since
 *   `useBrowserNavigationStack` passes `homeLabel: homeEntry.title` on every
 *   call, a host configuring a custom `homeEntry` would see any navigation back
 *   to the home url silently retitle itself to the generic default instead of
 *   the host's own label — a regression relative to `initialNavigationState`/
 *   `labelFromUrl`, which both already honored a custom home label correctly.
 *   Fixed to `options.homeLabel ?? DEFAULT_HOME_NAVIGATION_ENTRY.title`; covered
 *   by new `rules.test.ts`/`useBrowserNavigationStack.test.ts` cases.
 * - **Dead code, removed** — `MergeHistoryEntryOptions.homeLabel` (threaded
 *   through `mergeHistoryEntry` → `useBrowserHistory`'s `commitVisit`) could
 *   never actually affect anything: `mergeHistoryEntry` only calls
 *   `labelFromUrl` after its own `isHistoryUrl(url)` guard has already excluded
 *   `EMPTY_URL`, and `homeLabel` only changes `labelFromUrl`'s output on the
 *   `url === EMPTY_URL` branch. Removed the field from `MergeHistoryEntryOptions`
 *   and `UseBrowserHistoryOptions` rather than leaving a permanently-uncovered,
 *   inert option in the public API.
 * - **One line excluded from coverage, not faked** —
 *   `useBrowserNavigationStack.ts`'s `if (!currentEntry) return;` guard inside
 *   the `onNavigate`-firing effect was unreachable through the hook's public
 *   API: every state transition it performs (`initialNavigationState`/
 *   `recordNavigation`/`resolveNavigationHistoryDelta`/
 *   `updateCurrentNavigationTitle`, all in `rules.ts`) preserves
 *   `0 <= navigationIndex < navigationStack.length`, so `currentEntry` is always
 *   defined in practice — the guard existed only because
 *   `noUncheckedIndexedAccess` types the array-index read as possibly-undefined.
 *   **Correction (2026-07-17, per the vendored `fixing-open-design-web` SKILL.md's
 *   Phase 9.5 classification #4 — "TS-required fallback with no real runtime
 *   path"):** an initial pass marked this with `/* v8 ignore next * /`, which
 *   that skill's rule explicitly forbids ("never a valid outcome... under any
 *   classification"). Fixed to the classification's actual prescription: the
 *   `if` branch is deleted and the index read is a non-null assertion
 *   (`state.navigationStack[state.navigationIndex]!`) with a one-line comment
 *   explaining the invariant — no suppression comment anywhere in this feature.
 * - **`ports.ts`/`types.ts` excluded from coverage** — both are
 *   `export interface`/`export type` only; verified via the package's own
 *   esbuild transform that they compile to zero emitted statements, so
 *   v8/istanbul has no executable line to measure (reports 0/0 as 0%, not N/A).
 *   Excluded via `--coverage.exclude`, documented inline at the top of each
 *   file. `index.ts` (the barrel) is NOT excluded — it has real re-export
 *   statements that execute on import, and nothing else in the suite imported
 *   the barrel directly, so a small `index.test.ts` smoke test was added instead
 *   (also catches a typo'd/missing re-export a concrete-module test wouldn't).
 *
 * Also closed several genuine (non-dead) branch-coverage gaps with targeted
 * tests rather than exclusions: `recordNavigation`'s adjacent-entry rejoin and
 * `replacePendingTarget` branches (the back/forward state-machine logic
 * faithfully ported from the origin, previously untested); `recordNavigation`/
 * `updateCurrentNavigationTitle` given an out-of-bounds `navigationIndex` (both
 * are exported pure functions, so a malformed `BrowserNavigationState` is a
 * legitimately reachable input, not hook-internal dead code); `faviconUrl`'s
 * catch branch (`https://` with no host); `labelFromUrl`'s empty-hostname
 * fallback (`file://` urls); `cleanIconUrl`'s `data:image/` branch; the
 * `onNavigate` dedup-by-content check (a re-recorded identical url+title still
 * produces a new object reference via `updateEntry`, so the effect re-runs and
 * must dedupe on content, not just skip via unchanged reference);
 * `BrowserViewportControls`'s custom-`presets`-with-no-match and empty-`presets`
 * branches; and `createDefaultBrowserChromeDependencies`'s `historyLimit`-only
 * option combination.
 *
 * **Result**: feature-aggregate coverage on the executable-code portion (i.e.
 * excluding `ports.ts`/`types.ts` per above) is **100% Lines, 100% Branches,
 * 100% Functions, 100% Statements** — up from 99.15% / 87.77% / 97.56% / 99.15%
 * before this pass. Full suite: 101 tests across 7 files for this feature (up
 * from 78), 476 tests across 60 files package-wide (up from 453).
 * `pnpm --filter @jini/ui run typecheck` and `pnpm guard` both remain clean.
 *
 * ### Second follow-up pass (2026-07-17): `useX`/`useWiredX` wiring pairs, toolbox merge
 *
 * Two retrofits landed on this branch after the audit pass above:
 *
 * **`useWiredX` wirers.** Per the now-required `useX(port)` / zero-arg
 * `useWiredX()` pattern (see `apps/web/src/features/memory/hooks/
 * useMemoryConfig.hooks.ts` on the OD repo's `refactor/web-memory-slice` for
 * the reference shape), audited every hook in this feature against
 * `ports.ts`/`dependencies.ts` to see which actually take an injected port:
 *
 * - `useBrowserHistory` (takes `{ historyStorage: BrowserHistoryStoragePort }`)
 *   — got `useWiredBrowserHistory(scopeKey, options?)`, binding a module-level
 *   `createBrowserHistoryStorage()` singleton (the real, SSR-guarded
 *   `localStorage`-backed implementation — a meaningful production default).
 * - `useBrowserBridgeRegistration` (takes `{ bridgeRegistration:
 *   BrowserBridgeRegistrationPort }`) — got `useWiredBrowserBridgeRegistration
 *   (scopeKey, handle)`, binding `createNoopBrowserBridgeRegistration()`.
 *   Unlike the history port, there's no generic "real" default here by design
 *   (see `ports.ts`'s doc comment) — registering a handle only means something
 *   in the context of a host's own external bridge. A host that wants real
 *   bridge registration keeps calling `useBrowserBridgeRegistration` directly
 *   with its own port, same carve-out as a swappable test port, just for a
 *   real host implementation instead of a fake.
 * - `useBrowserNavigationStack` — **no wirer added.** Its `options` (`initialUrl`/
 *   `initialTitle`/`homeEntry`/`onNavigate`) are all plain local config, not a
 *   `ports.ts` port; the hook owns its state entirely via `rules.ts`'s pure
 *   functions. Nothing to wire.
 *
 * Both wirers exported from `index.ts`; no internal call sites needed updating
 * — this feature has no top-level assembling component (that lives in the
 * consuming host, out of scope per this feature's own "OUT OF SCOPE" section
 * above), so `useBrowserHistory`/`useBrowserBridgeRegistration` had zero
 * in-package callers before or after.
 *
 * **Toolbox merge.** Merged local branch `feat/ui-browser-toolbox` (commit
 * `c3e7f21`, not pushed to origin) — a clean merge, no conflicts (it branched
 * off a commit before `features/browser-chrome/` existed, so it never touched
 * this feature's files). It adds `packages/ui/src/browser/` (`useDismissOnOutsideOrEscape`,
 * `useGlobalKeydown`) as a thin wrapper over `utils/dom-subscriptions.ts`'s
 * `subscribeOutsideClickOrEscape`. `BrowserViewportControls.tsx`'s hand-rolled
 * `document.addEventListener('pointerdown'/'keydown', ...)` pair (the one
 * disclosed DOM-outside-`dependencies.ts` deviation noted earlier in this
 * section) is now `useDismissOnOutsideOrEscape(() => setOpen(false), { enabled:
 * open, containerRef: menuRef })` — same `pointerdown`-outside-or-Escape
 * behavior, dead local listener code removed. All of `BrowserViewportControls.test.tsx`'s
 * existing outside-click/Escape assertions pass unchanged against the shared
 * hook, confirming no behavior change.
 *
 * **Result**: still 100% Lines/Branches/Functions/Statements on the
 * executable-code portion after both retrofits (wirers came with their own
 * tests; the toolbox swap needed none new since it's a drop-in behind the same
 * public component API). 103 tests across 7 files for this feature; 494 tests
 * across 62 files package-wide (the toolbox branch's own `useDismissOnOutsideOrEscape.test.ts`/
 * `useGlobalKeydown.test.ts` account for the rest of the file-count jump).
 * `pnpm --filter @jini/ui run typecheck` and `pnpm guard` both remain clean.
 *
 * ---
 *
 * ### What did NOT get ported (and why)
 *
 * - **No `ports.ts`/`dependencies.ts`.** Unlike every other feature in this
 *   package, `ListDetailPanel` has zero transport/DOM surface of its own — the
 *   host supplies items, the current selection, and both renderers as plain
 *   props/render-callbacks. There is nothing here for a port to abstract; the
 *   DI-seam ceremony would be empty ceremony for a purely presentational
 *   primitive, so it was skipped rather than added for form's sake.
 * - **No visual skeleton markup.** `DesignSystemsTab.tsx`'s loading state is a
 *   richly detailed, OD-styled skeleton (specific row-variation patterns, a
 *   multi-section detail skeleton with its own CSS module). Per this package's
 *   established precedent (no `.module.css` ported anywhere in `@jini/ui` —
 *   see the flat-group porting section above), the loading state is generified
 *   to `loading` + `loadingSidebarContent`/`loadingDetailContent` slots; a host
 *   supplies its own skeleton visuals. The panel's only built-in loading-state
 *   contribution is the `role="status" aria-busy aria-label` wrapper.
 * - **Analytics, i18n dictionary keys, scope/surface/category filtering,
 *   `SystemRow`'s thumbnail-resolution logic, publish/delete/make-default
 *   actions** — all OD-specific, stay in OD.
 *
 * ### The root-level "flattened tree" quirk — verified, not assumed, and preserved
 *
 * `deriveTreeChildren` preserves a genuinely surprising piece of the origin's own `dirsAtCurrentDir`/`filesAtCurrentDir` `useMemo` verbatim: at the tree root (`currentDir === ''`), **every** file is pushed into `filesAtCurrentDir` — both root-level files and files nested under a subdirectory (which *also* separately contribute their top segment to `dirsAtCurrentDir`) — so the root view is a flattened "everything" listing with folders offered only as a secondary drill-down. Once navigated into any non-root directory, only files strictly at that one level are included. This asymmetry looked enough like a bug to warrant re-reading the real source line-by-line before committing to it (per the task's own "don't trust it blindly" instruction) — but it's exactly what the code does, so it's preserved rather than "fixed," with a `rules.test.ts` case asserting it explicitly (`'at the root, flattens every file (including nested) and surfaces the top-level dir'`).
 *
 * ### Where it landed, and why (`packages/ui/src/features/memory/`, not `chat-react`)
 *
 * Per `ADS-memory/reports/jini-port/god-components-extraction-plan.md`'s Consolidation map and
 * `packages/ui/README.md`'s scope boundary: Memory is a settings/data-management
 * surface (saved facts/preferences, an editable index, connector-sourced
 * suggestions) — the same shape as the already-shipped `features/connectors/` and
 * `features/settings-dialog/`, not a conversation surface. It lands alongside them
 * in `@jini/ui`, using the **new** `types.ts`/`constants.ts`/`rules.ts`/`ports.ts`/
 * `dependencies.ts`/`formatters.ts`/`async-commit-guard.ts`/`index.ts` at the
 * feature's top level, `hooks/`+`components/` under a `react/` subfolder — the
 * layout decided 2026-07-17, matching `features/viewer-shell/`/`features/asset-grid/`/
 * `features/sketch-editor/`, not `features/connectors/`'s older flat layout.
 *
 * ### The connector-reconciliation-reducer decision (the "third piece")
 *
 * The task brief's third sought piece — "connector-reconciliation reducers" — does
 * **not** come from PR #5228. Its real origin is Open Design's `main`-branch
 * `apps/web/src/components/connectors-state.ts` (confirmed by cloning
 * `https://github.com/leonaburime-ucla/open-design.git` at its default `main`
 * branch and reading `connectors-state.ts` directly, since `codex/connector-memory-settings`,
 * the branch originally suspected to hold this, diffs empty against current `main`
 * — i.e. that logic already lives on `main` by some other route). Its 4 functions
 * — `connectorAuthSnapshotChanged`/`hasConnectorStatusChanges`/`mergeConnectorCatalog`/
 * `applyConnectorStatuses` — are a **separate, shared/generic** connector-list
 * reconciliation module OD's `MemorySection.tsx` monolith imports directly
 * (`import { hasConnectorStatusChanges } from './connectors-state'`), distinct from
 * PR #5228's own Memory-local `mergeMemoryConnector`/`upsertMemoryConnector`/
 * `applyMemoryConnectorStatus(es)`/`connectorStatusesChanged` (which the PR's own
 * `rules.ts` comment calls "convenience duplication" of the shared module, kept
 * slice-local per the PR's own stated slice conventions).
 *
 * Direct line-by-line comparison found `@jini/ui`'s `features/connectors/rules.ts`
 * **already ships the generified port of `connectors-state.ts`** — from the
 * `ConnectorsBrowser.tsx` canary task (2026-07-17), see that section above —
 * as `mergeConnectors`/`applyConnectorStatuses`/`hasConnectorStatusChanges`/
 * `connectorAuthSnapshotChanged`, operating on the generic `Connector`/
 * `ConnectorStatusMap` types instead of OD's `ConnectorDetail`. Their logic is
 * identical to `connectors-state.ts`'s (verified field-by-field), and `mergeConnectors`
 * already subsumes what PR #5228's `mergeMemoryConnector`+`upsertMemoryConnector`
 * did (single-connector merge + array upsert in one pass). This is exactly the
 * overlap `god-components-extraction-plan.md`'s Consolidation map flagged in
 * advance: *"Memory slice's connector reducers... substantially overlap
 * `features/connectors`'... check whether it can import these directly instead of
 * re-deriving equivalents."*
 *
 * **Decision**: `features/memory/rules.ts` imports `mergeConnectors`/
 * `applyConnectorStatuses`/`hasConnectorStatusChanges` from `../connectors` and
 * re-exposes two thin, Memory-specific conveniences over them
 * (`upsertMemoryConnector` = `mergeConnectors(current, next ? [next] : [])`;
 * `applyMemoryConnectorStatus` = the 1-item form of `applyConnectorStatuses`, used
 * by the synthetic not-yet-detailed catalogue row). Only `connectorWithPendingAuthorization`
 * (no equivalent in `features/connectors`) is genuinely new Memory-local logic.
 * Memory's own connector type is `Connector` from `features/connectors/types.ts`
 * directly (not a third near-duplicate of `ConnectorDetail`) — its shape already
 * matches (id/name/provider/category/status/accountLabel/lastError/tools/toolCount/
 * toolsNextCursor/toolsHasMore/logoUrl).
 *
 * ### The consolidation decision: ONE primitive, with evidence
 *
 * Read both in full before designing anything, per the task brief. Verdict:
 * **consolidate into one `FileDropzone` primitive** — not two components
 * sharing a subdirectory, one component with configuration knobs. Evidence:
 *
 * 1. **Both are the exact same underlying interaction** — native drag/drop +
 *    click-to-browse, resolving to a flat `File[]` the host stages. The only
 *    real differences are *display* (thumbnail grid + lightbox vs. a plain
 *    prompt/names line) and which capabilities are wired on (paste,
 *    directory-select, the loading heuristic) — configuration, not a different
 *    component shape.
 * 2. **They already shared the same directory-walking algorithm at the OD
 *    source level**, just wired at different layers: `DropZone`'s `readDrop`
 *    calls `filesFromDataTransfer` (a `webkitGetAsEntry` recursive directory
 *    walker) internally before calling `onFiles`; `DesignSystemAssetDropzone`'s
 *    `onDrop` prop just hands the raw `DataTransfer` up to its parent
 *    (`DesignSystemFlow.tsx`'s `handleAssetDrop`), which calls the **exact
 *    same** `filesFromDataTransfer` function (same file, one module-level
 *    definition) before staging. One algorithm, two wiring styles — a textbook
 *    case for one primitive owning it internally always, which is what this
 *    port does (both variants now get directory-aware drop resolution for
 *    free, including the thumbnail-grid variant, which never had it before).
 * 3. **A duplicate of that same algorithm already existed a third time in this
 *    package** — `features/asset-tree-browser/rules.ts`'s `filesFromDataTransfer`
 *    (ported earlier from `DesignFilesPanel.tsx`, already fully generic). This
 *    is exactly the failure mode flagged by an independent audit the night
 *    this task was dispatched ("an undetected duplicate primitive") — so
 *    rather than writing a *fourth* copy for `file-dropzone`, this task
 *    promotes the shared logic to `utils/file-transfer.ts` (see below) and
 *    both features now import the one implementation.
 *
 * ### What's deferred, and why
 *
 * Per the `html-viewer` classification above: the sandboxed-iframe/postMessage-bridge core this feature's `resolvePreviewDocument` port is designed to eventually delegate to (`@jini/renderers-react`, currently a stub) does not exist yet. This feature does **not** wait on it — a host without a real sandbox core can implement `resolvePreviewDocument` as an identity function for a plain, unsandboxed preview, or delegate to whatever iframe-rendering mechanism it already has.
 *
 * **Update (2026-09-02):** this was accurate when written, but the same day
 * (2026-07-18) a parallel task landed the real sandboxed-iframe/postMessage
 * core (see `packages/ui/src/renderers/archived provenance ledger`'s "sandboxed-iframe
 * rendering core" section) — it now exists (`sandbox-bridge.ts`,
 * `sandboxed-document.ts`), and the package itself was later folded into
 * `@jini/ui` as `src/renderers/` rather than staying a separate
 * `@jini/renderers-react` package. The default fake dependency here
 * (`features/version-manager/dependencies.ts`) still uses a plain identity
 * stub for `resolvePreviewDocument` — that's an intentional default per the
 * fake-double convention, not evidence the real core is missing — a host
 * wanting the real sandbox behavior wires it to `src/renderers/` itself. `FileVersionViewportControls` was not re-ported; the orchestrator binds directly to `features/viewer-shell/`'s already-shipped `ViewportToggleGroup` (confirmed identical `role="group"`/`aria-pressed` shape by reading both source components side by side) rather than shipping a second, competing viewport-toggle primitive.
 *
 * ### A real cross-environment coverage-merge gap found and worked around
 *
 * Drafting `dependencies.ts`'s tests initially split them the way this
 * package's own documented convention prescribes for an SSR guard: a jsdom
 * test file for the "browser present" cases plus a separate
 * `// @vitest-environment node` companion for the "no `document` at all"
 * case. Coverage on the merged report showed that one guard's branch
 * (`typeof document === 'undefined'` in `exitFullscreen`) as **uncovered**
 * even though the node companion file, run alone, proved it covered — a real
 * `@vitest/coverage-v8` limitation merging branch-hit counts for one source
 * file instrumented under two different test environments in the same
 * `vitest run`. Fixed by moving every `createBrowserFullscreenPort` test
 * into a single `// @vitest-environment node` file, using a hand-built fake
 * `document` (a real `EventTarget` plus the two Fullscreen-API members this
 * port reads) for the "document present" cases instead of jsdom's real
 * global — eliminating the environment split (and the merge gap with it)
 * rather than leaving a genuinely-tested branch looking uncovered in the
 * aggregate. Worth flagging for any future task in this package relying on
 * the jsdom-file-plus-node-companion pattern for an SSR guard: verify the
 * *merged* per-file coverage, not just the companion file's own isolated
 * number, before trusting it clears the bar.

 * Archived provenance rationale:
 * ## Merge note (2026-07-18): reconciling with `port/renderers-react-and-annotation-canvas`
 *
 * This branch (`feature/jini-ui-html-viewer`) and `port/renderers-react-and-annotation-canvas`
 * (merged to `main` first) both independently built a sandboxed-iframe HTML
 * rendering core in this package, from the same OD origin file
 * (`runtime/srcdoc.ts`), without either branch seeing the other's work. On
 * merge, both cores are kept side by side rather than one replacing the
 * other, since `@jini/ui`'s `features/html-viewer` (this branch) is a real,
 * already-wired consumer of the `sandboxed-document.ts`/`sandbox-bridge.ts`/
 * `new-tab-preview.ts` core (`useSandboxBridge`, `openSandboxedPreviewInNewTab`),
 * while the `srcdoc/build.ts` core is the one wired into `buildSrcDoc`,
 * `SrcDocBridge`, `ArtifactView`, and the annotation-canvas integration above.
 *
 * The two cores' public surfaces are disjoint by name **except** for three
 * generic string-splice helpers both sides ported from the same origin
 * function shape: `injectAfterHeadOpen`, `injectBeforeHeadEnd`,
 * `injectBeforeBodyEnd`. They are not behaviorally identical — `srcdoc/
 * build.ts`'s versions add a `DOMParser`-based fallback for documents with no
 * matching `<head>`/`<body>` tag at all, which `html-utils.ts`'s versions
 * (deliberately, per `sandboxed-document.ts`'s own already-tested contract)
 * resolve via a plain string prepend/append instead. Both fallback behaviors
 * are real, disclosed, and independently test-covered (`html-utils.test.ts`
 * vs. `srcdoc/build.test.ts`'s "falls back to DOMParser" cases), so rather
 * than pick a winner, `srcdoc/build.ts`'s versions keep their original names
 * in the public barrel (`src/index.ts`) as the canonical/more broadly-used
 * ones, and `html-utils.ts`'s versions are re-exported under an
 * `injectAfterHeadOpenStringOnly`/`injectBeforeHeadEndStringOnly`/
 * `injectBeforeBodyEndStringOnly` alias. Neither implementation changed;
 * `sandboxed-document.ts` still imports its own `html-utils.ts` internally
 * under the original names, unaffected by the barrel-level alias.
 *
 * No other real naming collisions were found between the two cores'
 * `package.json`, `types.ts`, or barrel exports — `package.json`'s
 * dependency/devDependency lists were a union merge (both sides' React
 * version pins already matched); `types.ts`'s two additions
 * (`SandboxedDocumentOptions`/`SandboxedDocumentResult`/`SandboxBridgeMessage`/
 * `SandboxBridgeHandler` from this branch, `ArtifactFile` + the `@jini/
 * chat-core` manifest-vocabulary re-exports from `port/renderers-react-and-
 * annotation-canvas`) are simply concatenated, not merged shape-for-shape,
 * since neither side redeclares anything the other already had.
 *
 * ---
 */
// @jini-ai/ui — generic, product-neutral UI primitives.
// See packages/ui/README.md for scope and packages/ui/archived provenance ledger for
// provenance (multiple porting tasks land content here in parallel; see
// that file's per-section breakdown).
//
// Two feature domains with a heavy npm dependency are deliberately not re-exported here
// (2026-07-29): `sketch-editor` (`@excalidraw/excalidraw`, ~47MB — removed from this barrel,
// previously exported here and the reason any `@jini-ai/ui` import dragged Excalidraw in) and
// `lexical-rich-text-editor` (`lexical`/`@lexical/react`/`@lexical/utils` — never wired into this
// barrel at all, so it was actually unreachable dead code from outside this package until now).
// Both get their own `@jini-ai/ui/sketch-editor` / `@jini-ai/ui/lexical-rich-text-editor` entry
// points instead, so a consumer wanting e.g. `WorkingDirPicker`/`AgentIcon` never drags either
// in — import the specific subpath when you actually want that editor.

export * from './features/i18n/index.js';
export * from './features/admin-widgets/index.js';
export * from './features/panel-kit/index.js';
export * from './features/observability/index.js';
export * from './features/connectors/index.js';
export * from './features/progress-card/index.js';
export * from './features/browser-chrome/index.js';
export * from './features/asset-grid/index.js';
export * from './features/asset-tree-browser/index.js';
export * from './features/viewer-shell/index.js';
export * from './features/version-manager/index.js';
export * from './features/html-viewer/index.js';
export * from './features/tabbed-dialog/index.js';
export * from './features/settings/dialog/index.js';
export * from './features/appearance/index.js';
export * from './features/notifications/index.js';
export * from './features/language/index.js';
export * from './features/instructions/index.js';
export * from './features/privacy/index.js';
export * from './features/integrations/index.js';
export * from './features/execution/index.js';
export * from './features/skills/index.js';
export * from './features/project-locations/index.js';
export * from './features/about/index.js';
export * from './features/media-providers/index.js';
export * from './features/list-detail-panel/index.js';
export * from './features/schedule-picker/index.js';
export * from './features/mention-autocomplete/index.js';
export * from './features/memory/index.js';
export * from './features/source-config-list/index.js';
export * from './features/external-mcp/index.js';
export * from './features/resource-dashboard/index.js';
export * from './features/iframe-pool/index.js';
export * from './features/command-palette/index.js';
export * from './features/tab-launcher-menu/index.js';
export * from './features/revision-review/index.js';
export * from './features/file-dropzone/index.js';
export * from './features/folder-path-drop/index.js';
export * from './utils/index.js';
export * from './utils/timezone.js';
export * from './utils/zip.js';
export * from './utils/sse.js';
export * from './utils/copy-to-clipboard.js';
export * from './utils/appearance.js';
export * from './utils/dom-subscriptions.js';
export * from './utils/auto-open-file.js';
export * from './utils/localized-url.js';
export * from './utils/markdown-scroll-sync.js';
export * from './utils/polygon-selection.js';
export * from './utils/scroll-tabs-with-wheel.js';
export * from './utils/color-math.js';
export * from './utils/design-md.js';
// Promoted to the public barrel 2026-08-03: previously package-internal only, reached by
// `useFileDropTarget.js` (also exported below) and by three in-package features via relative
// import. `@jini-ai/chat`'s `./react` subpath needs `FILE_SYSTEM_READ_ERROR_MESSAGE` for a test
// assertion now that it's an external package rather than living inside `ui`.
export * from './utils/file-system-errors.js';

export * from './react/hooks/useInView.js';
export * from './react/hooks/useCoalescedCallback.js';
export * from './react/hooks/useStableHandler.js';
export * from './react/hooks/useDebouncedValue.js';
export * from './react/hooks/useResizableSplitPane.js';
export * from './react/hooks/useBrandFonts.js';
export * from './react/hooks/useEdgeAutoScroll.js';

export * from './browser/useModalWindowDragGuard.js';

export * from './browser/index.js';

// Named (not `export *`): Icon.tsx also exports `ICON_RENDERERS`, a test
// seam for asserting the name -> renderer lookup table directly. It must
// not reach this published package's public surface.
export { Icon, type IconName } from './react/components/Icon.js';
export * from './react/components/RemixIcon.js';
export * from './react/components/AgentIcon.js';
export * from './react/components/Toast.js';
export * from './react/components/Loading.js';
export * from './react/components/TooltipLayer.js';
export * from './react/components/CustomSelect.js';
export * from './react/components/KitErrorBoundary.js';
export * from './react/components/LanguageMenu.js';
export * from './react/components/WorkingDirPicker.js';
export * from './react/components/AppChromeHeader.js';
export * from './react/components/ExportDiagnosticsButton.js';
export * from './react/components/PaletteTweaks.js';
export * from './react/components/OptionCards.js';
export * from './react/components/CompactToggle.js';
export * from './react/components/ToggleRow.js';
export * from './react/components/StatCard.js';
export * from './react/components/Notice.js';
export * from './react/components/ImportChoice.js';
export * from './react/components/FileImportPanel.js';
export * from './react/components/OnboardingPanelHeader.js';
export * from './react/components/OnboardingChipField.js';
export * from './react/components/OnboardingDropdown.js';
export * from './react/components/BrandLogo.js';
export * from './react/components/HeaderActionsMenu.js';
export * from './react/components/EdgeScrollZones.js';
export * from './react/components/PillButton.js';
export * from './react/components/PopoverMenu.js';
export * from './react/components/PopoverItem.js';
export * from './react/components/EditorIcon.js';
export * from './react/components/TokenChip.js';
export * from './react/components/ValueChip.js';
export * from './react/components/ComponentKitPreview.js';
