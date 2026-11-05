Software Architect(Direct): I loaded the requested Software Architect persona. This is a read-only plan; no files were edited and no tests, builds, or servers were run.

**Goal**

Implement [todos.md item 7](/Users/la/Programming/Tovu/development/todos.md:33): give files that work together their own folder, using mechanical moves that preserve behavior. Start with the shared-service supervisor **after both integration branches land on main and the owner approves the plan**.

**Findings**

Paths below use `A = apps/admin/src`, `D = apps/desktop/src`, and `J = prov2-jini/packages/sidecar/src`. Rankings are qualitative estimates; the owner explicitly selected rank 1 as the pilot.

These clusters still use shared infrastructure. “Used together” does not justify moving every dependency into the feature.

| Rank | Cluster | Benefit / move risk | Source evidence |
|---|---|---|---|
| 1 | Jini service supervision | High / medium | [supervisor.ts:7](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/sidecar/src/supervisor.ts:7), [supervisor-node.ts:9](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/sidecar/src/supervisor-node.ts:9) |
| 2 | Desktop updates | High / low | [desktop-updater.ts:7](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/main/updates/desktop-updater.ts:7) imports adapters scattered at the source root. |
| 3 | CMS widget embedding | High / low | [widget-embed-extension.tsx:5](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/lib/widget-embed-extension.tsx:5) joins private state and placement UI across `lib` and `components`. |
| 4 | External MCP administration | High / medium | [use-providers.hooks.ts:24](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/features/providers/hooks/use-providers.hooks.ts:24) already documents this deferred mechanical move. |
| 5 | AssistantDock transport adapters | High / medium | [AssistantDock.hooks.tsx:1](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/components/AssistantDock/hooks/AssistantDock.hooks.tsx:1), [renderer registry:12](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/components/AssistantDock/hooks/use-dock-renderer-registry.hooks.ts:12) |
| 6 | Standing-draft CMS adapters | Medium / low | [use-standing-draft-autosave.hooks.ts:4](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/hooks/use-standing-draft-autosave.hooks.ts:4) couples the hook to a separately located backup adapter. |
| 7 | Desktop product telemetry | Medium / medium | [product-telemetry-boot.ts:11](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/main/updates/product-telemetry-boot.ts:11) assembles four root-level modules. |
| 8 | Desktop site workspace | Medium / medium | [SiteWorkspace.tsx:4](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/renderer/app/SiteWorkspace.tsx:4) imports its workspace and live-view controllers from another folder. |
| 9 | Website creation UI | Medium / medium | [CreateWebsiteHost.tsx:1](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/renderer/app/CreateWebsiteHost.tsx:1), [CreateWebsiteOnboarding.tsx:8](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/renderer/CreateWebsiteOnboarding.tsx:8) |
| 10 | Admin page capability adapters | Medium / medium | [App.hooks.ts:13](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/App.hooks.ts:13) composes navigation, screenshots and announcements scattered through `lib`. |

Discovery used the available Jini knowledge snapshot, installed dependency-cruiser, and current-source reference checks. MCP graph tools were unavailable; static imports do not establish runtime exclusivity.

**Design — smallest change**

Reuse existing folders and Jini implementations. Add only folders where a cluster lacks a home. Preserve filenames, functions, signatures, exports, registration order and dependency direction.

The pilot must retain its package boundaries: Tovu [desktop-agent-service.ts:11](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/desktop-agent-service.ts:11) correctly consumes both sidecar supervision and diagnostics. Diagnostics redaction, platform process utilities and the sidecar registry have broader responsibilities; folding them into supervision would increase coupling.

Use the **already-installed ts-morph** `SourceFile.move()` to calculate import/export rewrites in memory, loading callers and tests across the relevant projects. Perform filesystem renames with **`git mv`**, then apply the calculated edits. No new move tool or framework is needed.

Preserve every why-comment, including historical rationale. Update path references where necessary without deleting explanations. Keep formatting changes out so Git can recognize renames; inspect history with `git log --follow`.

**Steps — ordered, one independently revertible commit per numbered cluster**

Before step 1, confirm the required merges, reconcile existing working changes, consult governing documents, and record the implementation baseline. Both clones currently identify `merge-1029`; Tovu has substantial uncommitted changes.

1. **Supervisor pilot:** move `J/{supervisor.ts,supervisor-node.ts,respawn-policy.ts}` into `J/supervision/`, keeping basenames. Move dedicated supervisor/respawn tests beside them.
   Keep existing public entry files as export-only compatibility facades, preserving package export paths and universal/Node isolation. Rewrite private imports and test mocks; leave package-surface tests at their current location and retain shared registry/diagnostics dependencies.

2. **Desktop updates:** move `D/{auto-update-controller.ts,update-policy.ts,update-check-now.ts,desktop-update-preference.ts}` into existing `D/main/updates/`.
   Rewrite `main/index.ts`, `desktop-updater.ts`, `settings-menu.ts` and matching tests. Keep `instance-presence.ts` shared; do not change updater timing, preference storage or Jini delegation.

3. **Widget embedding:** move `A/lib/{widget-embed-extension.tsx,widget-embed-extension.hooks.ts,widget-embed-placement-content.ts}` and `A/components/WidgetConfigFields/PlacementContentFields.tsx` into `A/components/WidgetEmbed/`.
   Rewrite `CollectionEntryEditor.tsx`, internal references and matching tests. Keep shared media editors, picker controls, translations and CSS in their existing owners.

4. **External MCP:** move `A/features/settings/ExternalMcp*`, `external-mcp-*`, and `hooks/use-external-mcp*` into `A/features/providers/external-mcp/`, preserving the existing hook subfolder.
   Rewrite `Providers.tsx`, `use-providers.hooks.ts`, tests and fixtures. Move the dedicated `styles/external-mcp-tool-picker.css` there and rewrite its `main.tsx` import **in the same import position**. Retain dependencies on mixed `settings/rules.ts`; splitting its functions is outside this mechanical step.

5. **AssistantDock adapters:** move `A/lib/{typed-answer-poster.ts,a2ui-action-poster.ts,assistant-daemon-activation.ts}` into existing `A/components/AssistantDock/`.
   Rewrite the dock, its controller, renderer registry and matching tests. Keep shell-wide prompt/dock buses outside; preserve routes, credentials, cancellation and timeout behavior.

6. **Standing drafts:** move `A/hooks/use-standing-draft-autosave.hooks.ts` and `A/lib/{standing-draft-local-backup.ts,standing-draft-recovery-message.ts}` into `A/integrations/jini-admin/standing-drafts/`.
   Rewrite page/post editors, their rules, ports, dependency adapters and tests. Preserve the exact storage prefix and existing Jini autosave implementation.

7. **Desktop telemetry:** move `D/{product-telemetry.ts,product-telemetry-preference.ts,product-telemetry-ipc.ts,product-memory-telemetry.ts}` and `D/main/updates/product-telemetry-boot.ts` into `D/main/product-telemetry/`.
   Rewrite `main/index.ts`, `settings-menu.ts`, internal imports and tests. Keep renderer telemetry, cross-process contracts, website composition and generic Jini tracking/sampling in their existing owners.

8. **Site workspace:** move `D/renderer/app/{SiteWorkspace.tsx,SiteStartPanel.tsx}` and `D/renderer/{use-site-workspace.hooks.ts,use-live-views.hooks.ts}` into `D/renderer/app/site-workspace/`.
   Rewrite `App.tsx`, internal imports, dedicated tests and source-path assertions. Keep shared zoom, preference, bridge and spinner modules outside; preserve guest identity and mount behavior.

9. **Website creation:** move `D/renderer/app/CreateWebsiteHost.tsx` and `D/renderer/{CreateWebsiteOnboarding.tsx,use-create-website-form.hooks.ts,use-new-site-dir.hooks.ts,create-website-onboarding-policy.ts}` into `D/renderer/app/create-website/`.
   Rewrite `App.tsx`, the existing `App.hooks.ts` re-exports and matching tests. Keep the plugin-token hook shared with `MainContent.tsx`; retain form keys, credential handling and CSS targets.

10. **Admin page adapters:** move `A/lib/{agent-pages.ts,agent-navigation-entities.ts,agent-screenshot.ts,agent-screenshot-bus.ts}` into existing `A/features/webmcp/`.
    Rewrite `App.hooks.ts`, internal references and matching tests. Keep application composition, routes, capability identifiers and screenshot announcement behavior unchanged.

For every step, move its dedicated tests/fixtures together, inspect remaining old-path references, verify, then commit. Revert that commit to undo the cluster. No numbered step requires a later step.

**Tests — planned only**

- Reuse existing behavioral suites. Where coverage is missing, establish characterization first: demonstrate RED under a controlled regression, restore baseline, then move. Do not invent failing import tests merely to manufacture RED.
- Supervisor: fake child processes, scheduler, clock, readiness and registry; cover restart, parking, shutdown, refusal and universal-entry isolation.
- UI/adapters: reuse injected API/fetch, storage and bridge fakes; preserve stale-response handling, cancellation, draft recovery, consent and guest retention.
- After each move: relevant suites, type checks and existing boundary checks. Inspect mock strings, CSS imports and `new URL(..., import.meta.url)` paths manually; automatic import rewriting is insufficient for these.

**Risks**

The clone lacks mandatory architecture chapters 13/14 and Tovu project memory; this remains a provisional plan until those sources are consulted. Existing source-reading tests make path rewrites particularly important. Preserve public package facades and avoid loading both old and new implementation copies, which could duplicate singleton state.

**Out of scope**

Behavior fixes, package mergers, new abstractions, signature cleanup, vendor relocation, schema changes and plugin repackaging. Generic logic remains in Jini; Tovu moves contain existing wiring/CMS code. Any future schema change requires ADR-066 TS migrations; Drizzle remains frozen. Agent plugins remain `@jini-ai/agent-plugins` subpaths.

Function bodies remain unchanged. Preserve complexity ceilings of ≤10, or ≤9 in desktop; any necessary repair is a separate task. Added runtime reads, writes and polls: **0 calls × 0 bytes**; existing frequencies and payloads remain unchanged.

**Estimate**

Approximately **12–20 engineering hours**, including verification, after merge readiness. Pilot: **1–2 hours**. No additional tooling or optional architectural expansion is proposed.