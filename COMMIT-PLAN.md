# M26SI sheet 10 — Plugins (Jini half)

Working-tree changes only; coordinator commits. No installs, builds, tests,
typechecks, linters, or guards may run in this dispatch.

## Ordered commit plan

1. Implemented: inject AgentPlugins browser components through its required kit.
   - Tests first: `packages/admin/src/screens/plugins/__tests__/agent-plugins-kit.unit.test.tsx`.
   - Production: `AgentPlugins.tsx`, `AgentPluginsOverlays.tsx`,
     `AgentPluginsTabs.tsx`, `AgentPluginLists.tsx` in the same screen directory.
   - Mutation: restore any original direct provider/dialog/add-panel/row/manage/update-slot
     value import and render it instead of the kit field. The corresponding identity
     or rendered-slot assertion must fail.
2. Implemented: inject Plugins browser components and icons through its required kit.
   - Tests first: `packages/admin/src/screens/plugins/__tests__/plugins-kit.unit.test.tsx`.
   - Production: `Plugins.tsx`, `PluginsOverlays.tsx`, `PluginLists.tsx`.
   - Mutation: restore any original direct provider/overlay/row/add-panel/tab-icon/trash-icon
     value import and render it instead of the kit field. The corresponding identity
     or rendered-slot assertion must fail.

Both regression files are written before production edits. RED/GREEN and mutation
execution are deferred to the coordinator, as explicitly required by the dispatch.

## Boundaries

Only sheet 10 is assigned. Reuse original component signatures through type-only
imports. Preserve rules-provider identity, component props, event order, handles,
tabs, hooks, themes and comments. Existing public subpaths suffice; no export or
manifest changes are needed. Tovu must add the required kit fields at both binders.

## Final review

Re-read the seven production diffs and both new regression files against sheet 10.
The production changes only add required kit slots, replace named runtime imports
with type-only signatures, and thread kit through the existing rendering functions.
No helpers, contexts, exports, guards, themes, hook defaults, business rules or
comments were added or changed. No existing tests were deleted or weakened.

Tests added: 11 cases (5 AgentPlugins, 6 Plugins, counting parameterized cases).
Provider selection/rules identity, both list tabs, row/manage/update slots,
add panels, tab/marketplace/trash icons, and overlays are covered. The confirmation
test preserves clear-before-toggle order. New kit fixtures use real originals,
overridden per case to make direct-import mutations observable. AgentPlugins'
unused hook/dependency fields and unused install controllers are narrowed test
fixtures; those hooks/controllers are never executed in these projection tests.

Architecture audit: source review matches sheet 10. The six AgentPlugins and
seven Plugins named runtime-import edges are removed. Automated isolation results,
typing, RED/GREEN, mutation results, coverage and runtime validation remain
unverified: the dispatch prohibits every such command. Only file reads, scoped
symbol searches, `git status`, `git diff`, and working-tree edits were performed.

Function-quality review: existing renderers/binders retain their jobs, decisions,
callbacks, iteration complexity and effect order; kit selection adds O(1) reads.
Disposition: INCONCLUSIVE for mechanical/runtime evidence (commands prohibited);
source review found no new logic, complexity, naming, resource or hidden-dependency
issue. No refactor or documentation expansion was made outside the sheet.

Deletions: only the runtime import bindings explicitly replaced by required kit
slots. No files, behavior, why-comments or tests were deleted. No incidental code
was added and then removed during final scope review.

## Tovu handoff

All sources below already export through `@jini-ai/admin/screens/plugins/<module>`;
no new public subpaths or exports are required.

- `bindAgentPlugins.kit`: `PluginRulesProvider` (`rules-context`),
  `AgentPluginDisableConfirmDialog`, `AddAgentPluginPanel`, `AgentPluginRow`,
  `AgentPluginManageButton`, `AgentPluginUpdateSlot` (`AgentPluginUpdateControl`).
- `bindPlugins.kit`: the same `PluginRulesProvider` (`rules-context`),
  `PluginPackageFilesModal`, `PluginRemoveConfirmDialog`, `PluginRow`,
  `AddPluginPanel`, plus `InstalledTabIcon`, `DownloadedTabIcon`,
  `MarketplaceTabIcon`, `PluginTrashIcon` (`plugins-visuals`).
- Keep each existing `deps.pluginRules` and supply the original provider from
  `rules-context`, which is the context consumed by the original rows.

No assigned sheet was stopped. Sheets 1–9 and 12 were outside this dispatch;
sheet 11 is explicitly excluded because its generated payloads require a build.
All changes remain uncommitted; COMMIT-PLAN.md must not be committed.
