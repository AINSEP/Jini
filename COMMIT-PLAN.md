# m26 guard/admin handoff

Working tree only. No commits, staging, pushes, installs, builds, tests, typechecks,
linters, or guard execution. Coordinator commits and runs verification.

## Completed logical units, in implementation order

1. Neutralize the twelve listed N1/N2 source references (comments only).
   Files under `packages/admin/src/`:
   - `core/settings-tab-appearance.ts`
   - `pages/PageEditorPreview.tsx`
   - `pages/hooks/use-page-editor.hooks.ts`
   - `pages/page-route-rules.ts`
   - `posts/hooks/use-posts.hooks.ts`
   - `screens/media/MediaToolbar.tsx`
   - `screens/media/hooks/use-edit-media-panel.hooks.ts`
   - `security/host/AccessTokenDialogs.tsx`
   - `security/host/AccessTokensTab.hooks.ts`
   - `security/host/hooks/access-token-refresh.hooks.ts`
   - `shell/components/AssistantDock/AssistantDock.tsx`
   - `shell/components/AssistantDock/hooks/agents-inventory.hooks.ts`

2. Break the two listed R14 cycles with verbatim moves.
   Files under `packages/admin/src/`:
   - `screens/media/MediaEditChildren.tsx`
   - `screens/media/MediaEditFields.tsx`
   - `screens/plugins/AgentPlugins.tsx`
   - `screens/plugins/AgentPluginLists.tsx`
   - `screens/plugins/AgentPluginUpdateControl.tsx`
   Media copy/action components now live in MediaEditFields, which no longer
   loads MediaEditChildren. AgentPluginUpdateSlot now lives beside its control;
   AgentPluginLists imports the parent screen's types with statement-level
   `import type`. Existing rationale moves with the components.

3. Remove the routines screen's L1/L3/L5 dependency on the UI package.
   File: `packages/admin/src/screens/routines/Routines.tsx`.
   Existing RoutinesKit and SchedulePickerHook describe the injected picker
   structurally using React and core routine contracts. No runtime change.

4. Inject the HW8 credential URL placeholder through the existing bindings.
   Files under `packages/admin/src/security/host/`:
   - `AccessTokenDialogs.tsx`
   - `AccessTokensTab.tsx`
   - `__tests__/AccessTokensTab.unit.test.tsx`
   - `__tests__/y5-live-secrets.test.tsx`
   Existing fixtures supply the new required value; assertions are unchanged.

5. Make HW3 resume-capable agent state instance-owned.
   File: `packages/admin/src/shell/components/AssistantDock/hooks/agents-inventory.hooks.ts`.
   get/reset/record/replace/rescan receive the same required state reference.
   Recording still updates resume capability before writing the snapshot;
   replacing still records, replaces the cache, then records the deadline.

## Stopped: all 60 supplied SI-domain rows

The dispatch permits importing the owning domain's public subpath. On this
HEAD that does not satisfy the actual rule: `scripts/check-subpath-isolation.ts`
resolves public package imports in resolveRuntimeImport and sends their source
files through enqueueTargets exactly like relative imports. enqueueTargets
rejects the domain crossing regardless of public-subpath spelling.

Stopped this group under the dispatch's stop-on-design/code-mismatch rule.
No guard configuration, isolation ownership, baseline, or allowlist was changed.
The alternative needs a concrete ownership/leaf relocation or injection design;
none was supplied for these 60 edges. R14's plugin move also relocates its
existing control dependency to AgentPluginLists; that SI issue remains open.

## Tests and named mutations

No sheet names characterization cases or a mutation for this guard-only task.
No new cases, fixtures, factories, or invented mutations were added. Two existing
fixtures only receive the required placeholder dependency. No assertions or tests
were deleted or weakened. Tests and guard must be run by the coordinator.

## Host integration

- Supply `AccessTokensTabBindings.deps.customCredentialBaseUrlPlaceholder` as
  `https://api.example.com` to preserve the previous placeholder.
- Allocate `{ current: new Set<string>() }` per admin boot and pass it as
  `resumeCapableAgentIds` to getResumeCapableAgentIds, resetResumeCapableAgentIds,
  recordAgents, replaceAgents, and rescanAgentsInto. Bind transport reads and
  inventory writes to the same reference; retain it across pane remounts.
- AgentPluginUpdateSlot is now exported by the existing
  `@jini-ai/admin/screens/plugins/AgentPluginUpdateControl` subpath instead of
  the AgentPlugins module. Its only local runtime caller was repointed.
- No new subpaths, manifest changes, or source files are required.

## Diff audit and deletions

Source inspection addresses 19 supplied rows; execution verification is pending.
Architecture audit: WARNING, because the SI group is unresolved.
Read-only comparisons against HEAD confirm both moved source blocks are verbatim.
The twelve named neutrality files contain none of the reported forbidden text.

Required deletions only: the old locations of four media components and
AgentPluginUpdateSlot, their obsolete imports, the routines UI type import, and
the module-global resumeCapableAgentIds binding. No files or tests were deleted.
The intermediate placement of AgentPluginUpdateSlot inside AgentPluginLists was
removed; its final owner is the existing exported control module.
No unrelated cleanup or abstraction remains in the diff. This handoff file is
local and must not be committed.
