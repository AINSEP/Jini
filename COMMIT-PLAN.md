# Round 2 w3b-ext-a1 — Jini working-tree handoff

Starting HEAD: 6e20bc15e (round-1 extraction work). Source anchors read from Tovu 724ddc31a. No commits, pushes, tests, builds, installs, typechecks or linters run. No subagents, codebase-memory tools or repo-wide code searches used. All changes remain in this working tree; exclude this COMMIT-PLAN.md from coordinator commits.

## Completed implementation groups, in design order

1. **J21 — Execution ledger/model/selection.**
   - Create `packages/admin/src/shell/components/AssistantDock/hooks/{execution-config-ledger.hooks.ts,execution-config.hooks.ts,byok-runtime.hooks.ts,local-cli-selection.hooks.ts}`.
   - Create the four named witnesses under that folder's `__tests__/`: `execution-ledger.refresh-fences.unit.test.tsx`, `execution-config.presence-scope.unit.test.tsx`, `byok-runtime.discovery-generation.unit.test.tsx`, `local-cli-selection.normalization.unit.test.tsx` (five cases).
   - Required mutations: `M-accept-pre-write-read` removes the writesAtStart fence; `M-collapse-unread-key-to-false` reports false on failed presence read; `M-use-stale-model-discovery` removes cancelled fencing; `M-save-normalization-echo` routes the echo into apply/persist. Mutation execution remains Opus work.
   - Metadata: `.changeset/admin-extraction-21.md`, admin package manifest and API baseline, CAPABILITIES.md.
2. **J23 — Composer discovery/refusal projection.**
   - Create `packages/admin/src/shell/components/AssistantDock/hooks/composer-discovery.hooks.ts`; change existing `composer-files.hooks.ts` only to add `withSizeRefusalCopy`.
   - Create `__tests__/composer-catalog.scope-and-force.unit.test.tsx` and `composer-upload-refusal.forwarding.unit.test.ts` (three cases).
   - Mutations: `M-show-prior-scope-catalog` removes the render fence; `M-drop-attachment-upload-options` drops batch/signal; `M-skip-allowlisted-dispatch` omits the caller in outcome resolution.
   - Metadata: `.changeset/admin-extraction-23.md`, admin manifest/baseline, CAPABILITIES.md.
3. **J27 — Widget field dispatcher.**
   - Create `packages/cms/src/react/widgets/WidgetConfigFields/{WidgetConfigFields.tsx,WidgetConfigFields.controls.tsx}`. The second file is the private split of existing field controls; no additional package export.
   - Create `__tests__/WidgetConfigFields.collection-field-contract.unit.test.tsx` (one case, two catalogs).
   - Mutation: `M-retain-invalid-sort-after-collection-change` bypasses the injected setCollection reset wiring. The named witness asserts both catalogs use that callback; the existing hook still owns the reset body.
   - Metadata: `.changeset/admin-extraction-27.md`, cms manifest/baseline, CAPABILITIES.md.
4. **J29 — Collection entry editor.**
   - Create `packages/cms/src/react/collections/{CollectionEntryEditor.tsx,CollectionEntryEditor.fields.tsx}`. The fields module is a private split; BodyEditor remains opaque and TipTap stays in Tovu.
   - Create `__tests__/CollectionEntryEditor.body-slot-and-field-validity.unit.test.tsx` (one case).
   - Mutations: `M-render-terms-before-entry-exists` renders taxonomy for an unsaved entry; `M-skip-json-validity` omits the validity callback.
   - Metadata: `.changeset/admin-extraction-29.md`, cms manifest/baseline, CAPABILITIES.md.
5. **J35 — External MCP banner/add form.**
   - Create `packages/mcp/src/react/external-mcp/{ExternalMcpAdmissionsBanner.tsx,ExternalMcpSettingsPanel.hooks.tsx}`.
   - Create `__tests__/ExternalMcpAdmissionsBanner.refusal-actions.unit.test.tsx` and `ExternalMcpAddForm.default-and-cancel.unit.test.tsx` (four cases).
   - Mutations: `M-grant-from-a-connection-level-row`, `M-patch-unmatched-connection`, `M-overwrite-explicit-http-auth-mode`, `M-show-restart-without-permission`.
   - Metadata: `.changeset/admin-extraction-35.md`, mcp manifest/baseline/tsconfig, CAPABILITIES.md. React is optional; browser leaves do not change node server entrypoints. Dev React/DOM/types/testing-library/jsdom follow the CMS witness setup. No lockfile regeneration or installation attempted.

All ten named witness files were written before their production files. Fourteen cases were added; no existing tests were deleted or weakened. No tests or named mutations were executed.

## LEFT / STOPPED
- J25 NEEDS-OPUS: required literal DockStateInput/group/slot types not supplied. T25 belongs to Tovu and also NEEDS-OPUS.
- J26 STOP prerequisite: round-1 J17 HtmlAttributeRows leaf absent (the directory and HtmlAttributeRows leaf were absent at starting HEAD; J27 now creates the directory). J18 media-picker leaves exist.
- J34 STOP prerequisite: round-1 J09 webhook React binding/leaf absent from this round-1 checkout.
- All T21–T35: other repository, excluded from this job.

- J22 STOP: the existing readAgentsResponse decoder constructs `${label} answered with no agents`, while the sheet requires labels outside the leaf but supplies no decoder/label seam. A draft substituting a label would violate verbatim behavior; draft production and its two test files deleted before handoff. No J22 export registered.
- J24 STOP: isTerminalRunStatus is available in admin only through the React kit; the existing pure helpers import @jini-ai/chat/core. Admin's documented dependency boundary permits core/protocol, not chat, and core has no equivalent export. Sheet does not name an injected predicate or permit adding/reimplementing it. No production edits.

- J28 STOP: the review FIX requires outer `useAddControl: typeof useWidgetAddControl`, but that neutral hook requires port/locale/t/describeError; the outer call sites at source :250/:300 supply only triggerLabel/onResolved/initialWidgetType. There is no literal outer prop delivery or bound-hook contract for these required dependencies. No production/test files created.
- J30 STOP: current controller uses parseOptionalPixelSize in both size setters and mediaCreatedByLabel in creator projection. The prescribed deps object names neither and cms cannot import the admin rules. Adding collaborator members or reimplementing these bodies would exceed the sheet. No production/test files created.
- J31 LEFT dependent on stopped J30.
- J32 STOP: install/update hooks and their injected view slots exchange host controller results (AgentPluginInstallHost, FolderZipPort, useAgentPluginInstall/useAgentPluginUpdate results) with no literal portable types. Existing names resolve only under admin/screens, which this sheet expressly forbids importing; additional opaque-result generics/types are not named by this sheet and are prohibited by the dispatch. Needs concrete host-slot contracts before moving this group. No production/test files created.
- J33 STOP: ReentryNotices :50 contains the product-specific translation key “A key for this plugin was saved in an older format that Tovu no longer reads. Enter it again here and save.” Sheet requires product-neutral plugins output but lists no productName/copy/notice slot to carry this key. Verbatim copy leaks host identity; substituting text changes the dictionary lookup. No production/test files created.


## API baseline deltas (declaration fingerprints require Opus built-output verification)
- J21: `api-baseline/jini-ai__admin.json` `./shell/components/AssistantDock/hooks/execution-config-ledger.hooks`: EXECUTION_CONFIG_MAX_AGE_MS, useExecutionConfigLedger.
- J21: `api-baseline/jini-ai__admin.json` `./shell/components/AssistantDock/hooks/execution-config.hooks`: UseExecutionConfig, DockExecutionConfigPort, ExecutionWrite, useStoredAdminKey, useExecutionConfig.
- J21: `api-baseline/jini-ai__admin.json` `./shell/components/AssistantDock/hooks/byok-runtime.hooks`: UseByokRuntime, useByokModels, useByokRuntime.
- J21: `api-baseline/jini-ai__admin.json` `./shell/components/AssistantDock/hooks/local-cli-selection.hooks`: UseLocalCliSelection, useLocalCliSelection.
- J23: `api-baseline/jini-ai__admin.json` `./shell/components/AssistantDock/hooks/composer-discovery.hooks`: UseComposerCapabilities, useComposerCapabilities, useComposerDiscoverySelect.
- J23: `api-baseline/jini-ai__admin.json` `./shell/components/AssistantDock/hooks/composer-files.hooks`: withSizeRefusalCopy.
- J27: `api-baseline/jini-ai__cms.json` `./react/widgets/WidgetConfigFields/WidgetConfigFields`: WidgetConfigFieldsProps, WidgetConfigFields.
- J29: `api-baseline/jini-ai__cms.json` `./react/collections/CollectionEntryEditor`: CollectionEntryEditorProps, CollectionEntryViewController, CollectionEntryEditor.
- J35: `api-baseline/jini-ai__mcp.json` `./react/external-mcp/ExternalMcpAdmissionsBanner`: ExternalMcpAdmissionsBannerProps, ExternalMcpAdmissionsBanner.
- J35: `api-baseline/jini-ai__mcp.json` `./react/external-mcp/ExternalMcpSettingsPanel.hooks`: resolveExternalMcpCardHandles, useSavedAllowedToolNamesById, useExternalMcpDriftCopy, buildAllowWritePatch, ExternalMcpAddFormController, useExternalMcpAddForm.

## Final diff deletions / scope review

- Deleted the temporary J22 production drafts and their two temporary test files after discovering the missing label/decoder contract. No J22 package export, changeset or baseline delta remains.
- Removed the test-only DOM-option insertion draft from the J27 witness; the witness now loads both catalogs through the injected options hook.
- Removed an unnecessary export on private fieldHandleSegment.
- Restored untouched package JSON Unicode/indentation and the original mcp baseline indentation after metadata edits.
- Product-specific portions of mixed comments remain in the unchanged Tovu sources; portable why-comments move with the extracted code. No Tovu files were modified or deleted.

## Verification / architecture handoff

**WARNING — implementation only, untested.** Manually reviewed new imports/required collaborator delivery, source decision bodies, omitted-value forwarding, J35 grant/restart gates, file splits and package metadata. No new runtime package dependency on admin/ui/chat was added; the new admin hooks use the existing kit and relative admin modules. Behavioral and generated API verification remain Opus work by dispatch instruction. Every new source file is below 500 lines; the pre-existing composer-files file only gains the named helper.

The API baseline values ending `:pending-opus` are explicit symbol inventory placeholders, not generated declaration fingerprints. Regenerate/verify these three baselines from built output before integration. React test dependencies and peer setup also require the coordinator's normal lockfile update/install; no install was authorized here.

## What the Tovu half needs

Bind T21/T23 to the exact admin hook leaves listed below, including required retry/subscription/write ports, scope factories and watcher cleanup. Existing composer-files export gains only withSizeRefusalCopy. T27 mounts the cms dispatcher with existing media view, hooks, filtered collection port and rule bindings. T29 mounts the opaque body/taxonomy/server-label/field-reader slots and preserves its lazy key. T35 binds the new MCP banner/helpers and adds direct @jini-ai/mcp as specified. Do not wire stopped J22/J24/J26/J28/J30/J32/J33/J34 or their dependent views until the listed prerequisite/contract issues are resolved.
