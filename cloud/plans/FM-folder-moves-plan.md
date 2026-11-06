Software Architect(Direct): Goal: finish four useful folder groups with mechanical moves; drop five whose churn exceeds their value.

Read-only review completed against local `origin/cloud/combine`: Tovu `5358aa594`, Jini `b0cc1371b`. No files changed; no tests, builds, installs, servers or fetches ran. Graph tools were unavailable, so discovery used Git snapshots.

Paths below are repository-relative. `A = apps/admin/src`, `D = apps/desktop/src`, `R = D/renderer`, `S = A/features/settings`, `P = A/features/providers/external-mcp`. Brace lists mean exact filename expansions; moves preserve basenames.

**Findings**

- **Pilot facades are unnecessary.** Jini `packages/sidecar/package.json:33` maps the published subpaths directly into `dist/supervision/`; `src/index.ts:74` exports the moved implementations. The three original source facades are absent. Preserve public package specifiers; restore nothing. Pilot behavioral verification remains **UNVERIFIED** in this review.
- **External MCP grew:** 5,576 → **5,644 source lines**, now 18 files including CSS. The new `S/ExternalMcpSharedChoice.tsx:6` and shared-save OAuth changes belong in its move set. `S/ExternalMcpSettingsPanel.tsx:1` imports the chooser.
- **The other eight source totals match the old plan.** Their caller files can nevertheless contain newer merged changes. Rewrite today’s files; never replay old copies.
- **Widget embedding has three editor callers:** `A/features/collections/CollectionEntryEditor.tsx:5`, `collections/hooks/use-collection-entry-editor.hooks.ts:12`, and `posts/hooks/use-post-editor.hooks.ts:25`.
- **Two low-value groups are especially weak:** standing-draft recovery is already a Jini re-export (`A/lib/standing-draft-recovery-message.ts:2`); daemon activation serves both the dock and shell (`A/App.hooks.ts:14`). Moving activation under the dock would misstate ownership.

TRIM’s sweeps section (`cloud/plans/TRIM.md:17–18`) still holds folders behind the merge gate. Use your stated sequence: all other jobs merged into final combined heads, this run alone, then full tests. The old ahead-of-main counts are stale readiness evidence.

**Branch overlaps**

| Job | Checked result |
|---|---|
| `consent-declare` | Its Tovu branch-only admin changes are in `features/consent/`; no overlap with these moves. |
| `forms-left` | No branch-only admin/desktop changes; reported work is website/CMS code. |
| `release-fixes` | No branch-only admin/desktop/sidecar changes. |
| `small-fixes` | No branch-only admin/desktop/sidecar changes at the inspected tips. |
| `om-chat-3` | Jini changes do not touch sidecar. Tovu ref is unavailable; its Jini report says the Tovu push was blocked. Tovu overlap **UNVERIFIED**. |
| `ui-fixes` | Neither local branch nor remote-tracking ref is available. Overlap **UNVERIFIED**, especially editor UI, MCP UI, and renderer files below. |

Do not start from these cached heads while the missing jobs remain unresolved.

**Ordered work, ranked by value for churn**

1. **Group 2 — desktop updates. FIRST GROUP; acceptable stopping point.**

   Move:

   ```text
   D/{auto-update-controller,update-policy,update-check-now,desktop-update-preference}.ts
     → D/main/updates/
   ```

   Move their four corresponding `.test.ts` files alongside them. Rewrite these additional files:

   ```text
   D/main/index.ts
   D/main/updates/{desktop-updater.ts,desktop-updater.test.ts,settings-menu.ts}
   ```

   Rough change: **288 production lines relocated; +25–45/−25–45 import/comment lines**, plus test relocations and path rewrites.

   Later tests: the four moved suites and `desktop-updater.test.ts`.

   **Why not smaller:** this completes an existing updates folder without leaving its controller, policy and preference scattered at the root.

2. **Group 3 — widget embedding.**

   Move:

   ```text
   A/lib/{widget-embed-extension.tsx,widget-embed-extension.hooks.ts,
          widget-embed-placement-content.ts}
   A/components/WidgetConfigFields/PlacementContentFields.tsx
     → A/components/WidgetEmbed/
   ```

   Rewrite the three editor callers named above. Update the path references in:

   ```text
   A/features/{collections,posts}/README.md
   ```

   Move these tests into `A/components/WidgetEmbed/__tests__/`:

   ```text
   A/lib/__tests__/widget-embed-extension.unit.test.tsx
   A/lib/__tests__/{widget-embed-extension.hooks,widget-embed-placement-content,
                    mediawidget-extension}.unit.test.ts
   A/components/WidgetConfigFields/__tests__/PlacementContentFields.unit.test.tsx
   ```

   Rough change: **521 production lines relocated; +35–60/−35–60 rewrite lines**, plus tests. Later tests: those five suites.

   **Why not smaller:** these four files jointly implement the embed; moving only the extension leaves its private state and placement UI split.

3. **Group 7 — desktop telemetry.**

   Move:

   ```text
   D/{product-telemetry,product-telemetry-preference,product-telemetry-ipc,
      product-memory-telemetry}.ts
   D/main/updates/product-telemetry-boot.ts
     → D/main/product-telemetry/
   ```

   Move all five corresponding `.test.ts` files alongside them. Rewrite:

   ```text
   D/main/index.ts
   D/main/updates/{settings-menu.ts,settings-menu.test.ts}
   ```

   Rough change: **556 production lines relocated; +35–65/−35–65 rewrite lines**, plus tests.

   Later tests: the five moved suites and `settings-menu.test.ts`.

   **Why not smaller:** the boot file currently lives under updates while assembling four telemetry modules elsewhere. Keep renderer telemetry, contracts, website composition and Jini diagnostics in their existing homes.

4. **Group 4 — External MCP. Largest group; do last.**

   Move the following from `S/` to `P/`, preserving `hooks/`:

   ```text
   ExternalMcp{AdmissionsBanner,RemoveConfirmDialog,SettingsPanel,
               SettingsPanel.hooks,SharedChoice,ToolPicker,ToolPicker.hooks,
               ToolsModal}.tsx
   ExternalMcpToolsModal.hooks.ts
   external-mcp-{admissions-rules,i18n,tool-picker-rules}.ts
   hooks/use-external-mcp{,-admissions,-oauth-connect,-remove-confirm,
                          -tool-picker}.hooks.ts
   ```

   Also move:

   ```text
   A/styles/external-mcp-tool-picker.css → P/external-mcp-tool-picker.css
   ```

   Rewrite:

   ```text
   A/features/providers/Providers.tsx
   A/features/providers/hooks/use-providers.hooks.ts
   A/main.tsx
   A/lib/__tests__/credential-fidelity.unit.test.ts
   ```

   Keep the CSS import at its current position in `main.tsx:26`. Keep mixed `S/rules.ts` where it is; rewrite references to it rather than extracting functions.

   Move these dedicated tests from `S/__tests__/` to `P/__tests__/`:

   ```text
   ExternalMcp{AdmissionsBanner,SettingsPanel.hooks,SettingsPanel,
               SharedChoice,ToolsModal}.unit.test.tsx
   built-in-mcp.unit.test.tsx
   external-mcp-{admissions-rules,tool-picker-rules}.unit.test.ts
   external-mcp-{agent-drive,missing-launcher-recovery}.unit.test.tsx
   use-external-mcp-remove-confirm.hooks.unit.test.tsx
   use-external-mcp-tool-picker{.cached-server,.hooks}.unit.test.tsx
   ```

   Move `S/hooks/__tests__/use-external-mcp{,-oauth-connect}.unit.test.ts` and `use-external-mcp-admissions.unit.test.tsx` into `P/hooks/__tests__/`. Move `A/styles/__tests__/external-mcp-tool-picker-css.unit.test.ts` into `P/__tests__/`.

   Rough change: **5,644 production lines relocated; +110–190/−110–190 rewrite lines**, plus tests.

   Later tests: those 17 moved suites, credential fidelity, and the existing Providers/Settings integration suites.

   **Why not smaller:** this completes the already documented ownership correction (`use-providers.hooks.ts:24`). Splitting components, hooks, translations and dedicated CSS across jobs leaves an incomplete slice.

**Drop these five groups from this run**

These are the exact old proposed mappings; **make none of these changes**.

| Value rank / group | Old → proposed destination | Reason to drop |
|---|---|---|
| 5 / **10** | `A/lib/{agent-pages,agent-navigation-entities,agent-screenshot,agent-screenshot-bus}.ts` → `A/features/webmcp/` | 510 lines; shell-wide adapters already compose together. Limited benefit for shell/test churn. |
| 6 / **8** | `R/app/{SiteWorkspace,SiteStartPanel}.tsx`, `R/{use-site-workspace,use-live-views}.hooks.ts` → `R/app/site-workspace/` | 1,120 lines; existing renderer ownership is understandable. |
| 7 / **9** | `R/app/CreateWebsiteHost.tsx`, `R/CreateWebsiteOnboarding.tsx`, `R/{use-create-website-form,use-new-site-dir}.hooks.ts`, `R/create-website-onboarding-policy.ts` → `R/app/create-website/` | 647 lines; cosmetic gain requires renderer barrel and lifecycle-test rewrites. |
| 8 / **5** | `A/lib/{typed-answer-poster,a2ui-action-poster,assistant-daemon-activation}.ts` → `A/components/AssistantDock/` | 102 lines; activation also belongs to shell composition. |
| 9 / **6** | `A/hooks/use-standing-draft-autosave.hooks.ts`, `A/lib/{standing-draft-local-backup,standing-draft-recovery-message}.ts` → `A/integrations/jini-admin/standing-drafts/` | 42 lines, already thin Jini adapters; disproportionate editor import churn. |

**Mechanical rewrite and proof**

Reuse installed Tovu `ts-morph`; add no move framework. Resolve imports against the final source snapshot, calculate moves in memory, then use `git mv`. Update imports, exports, dynamic imports, mock specifiers and source/CSS file references. Preserve explicit `.js`/`.ts` suffixes and aliases.

Resolve actual targets before rewriting: same-name website or renderer modules are separate owners.

For each group, allow only mapped renames, necessary path-string edits and minimal comment-path/status corrections. Compare each old/new file after reversing those approved edits: everything else—including function bodies, assertions and “why” explanations—must match byte-for-byte. Check unchanged dependency targets, registration order, package exports and test discovery. Record typechecks, focused suites and existing boundary/complexity checks during implementation; full tests follow the completed or deliberately partial run.

Use **one complete group per revertible commit**. Never commit half-rewritten imports. Start another group only with enough time to finish its proof. If the limit arrives mid-group, undo that group alone. **Stopping after group 2 is fine**; hand that checkpoint to the full-test job without claiming release readiness.

**Cost and limits**

- Added production reads: **0 per operation × 0 bytes**.
- Added production writes: **0 per operation × 0 bytes**.
- Added polls/timers: **0 per interval × 0 bytes**.
- One-time move work per group: one parse pass × affected source/test/caller bytes; one save × changed-file bytes; one parity comparison × before-and-after bytes. The four production move sets currently total **457,685 bytes**; final caller/test volume is **UNVERIFIED** until the remaining merges land.

No behavior fixes, forwarding facades, barrels, new ports, generic-code extraction, signature cleanup, vendor moves, plugin imports, schema changes or boot refusals. Existing Jini ownership, injected ports, signatures and complexity ceilings remain intact.

Estimated effort: **6–9 Codex hours**, including focused verification; full repository tests are the following job. Group 2 alone: roughly **1 hour**.

Owner-only questions: **none needed to refresh this plan**.