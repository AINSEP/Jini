# y5p-set — Jini working-tree delivery

Coordinator commits this plan's changes in the order below. Do not commit this file.
No git metadata mutations, commits, pushes, installs, builds, tests, typechecks or
linters were run. Source parsing and read-only diff/manifest inspection only.

Source: Tovu 48f6802924. All assigned anchors match:
settings-tabs 58/69/94/104/154/199/206/214/222/237/266/271/278/284/341/350;
SettingsUi 226/281/335/682/723;
ExternalMcpSettingsPanel 160/200/312/408/459/511.
No sheet was stopped for anchor drift. No other sheets were implemented.

## 1. adm-shell-lib — complete assigned Jini gap

Inherited and retained: createSettingsTabs, the six codec pairs, their existing
universal entry, and all six characterization tests. Added the required tested
browser adapter at that same entry; the codec/writer implementation is unchanged.

Files touched:
- packages/admin/src/core/__tests__/y5-settings-tabs.test.ts — test written first.
- packages/admin/src/core/settings-tabs.ts — createPrivacyConsentBrowserAdapter.
- .changeset/y5-adm-shell-lib.md — extend the existing minor changeset.

Named mutation: DEFER_WITHDRAWAL_UNTIL_WRITE, in settings-tab-privacy.ts:
move deps.onMetricsWithdrawal() after the awaited metrics write. The inherited
"withdrawal denies immediately even when the first write fails" assertion must
fail because the deny event disappears on a rejected first write. NOT EXECUTED.
The new browser-adapter case checks storage failure still signals denial and a
successful save clears the denial marker before dispatching confirmed consent.

Tovu binding inputs:
- Import createPrivacyConsentBrowserAdapter and createSettingsTabs from
  @jini-ai/admin/core/settings-tabs. The latter's existing API is unchanged.
- The adapter takes { deps: { getBrowser, createEvent, observe, withdrawalKey,
  consentEvent, saveMarkerStep, clearMarkerStep } }.
- getBrowser is the one-expression typeof-window adapter, returning window or
  undefined; createEvent is the one-expression CustomEvent adapter. Storage is
  read inside the existing fallback boundary, not while constructing the binding.
- Preserve the exact existing storage key, event name and step strings as host data.
  observe is the injected error sink; a no-op retains the original fallback policy.
- Supply the returned onMetricsWithdrawal and onMetricsSaved to createSettingsTabs.
- Keep every existing exported constant/type/name, including ADMIN_LOCALES bound
  locally, as required by the sheet. No host codec copy is needed.

## 2. adm-other — complete both assigned settings surfaces in Jini

Tests were extended before creating either production counterpart.

Files touched:
- packages/admin/src/screens/__tests__/y5-admin-surfaces.test.tsx
- packages/mcp/src/react/external-mcp/__tests__/y5-external-mcp.test.tsx
- packages/admin/src/screens/settings/SettingsUi.tsx (new public leaf)
- packages/admin/src/screens/settings/SettingsUiTabs.tsx (new private split)
- packages/mcp/src/react/external-mcp/ExternalMcpSettingsPanel.tsx (new public leaf)
- packages/mcp/src/react/external-mcp/ExternalMcpSourceRow.tsx (new private split)
- packages/mcp/src/react/external-mcp/ExternalMcpPanelSections.tsx (new private split)
- packages/admin/package.json
- packages/mcp/package.json
- .changeset/y5-adm-other.md

New public subpaths:
- @jini-ai/admin/screens/settings/SettingsUi — SettingsUi, SettingsUiProps,
  bindSettingsUi. Source exports; jini.entries browser.
- @jini-ai/mcp/react/external-mcp/ExternalMcpSettingsPanel — panel, props,
  bindExternalMcpSettingsPanel. Dist exports matching its folder's sibling;
  jini.entries browser. The coordinator's build must produce its dist files.

The raw views require kit, hooks and deps. Each binder captures all three and
returns the configured mount. Raw views receive required injected hooks for test
composition; binders add no override options or live hook defaults. Private files have no manifest entries.

Settings binder inputs:
- hooks: useAdminThemeBoundaryHook, useSettingsUiHook,
  useSettingsActiveTabScrollHook, useSettingsLocaleSyncHook,
  useSettingsExecutionHook (bind the existing host execution adapter),
  useExecutionPolicy, useAiAgentPresentationHook,
  useAdminExecutionCredentialHook, useAdminLocale, useUserInterfaceTab,
  useAdminBrowserAgentSettings.
- kit: I18nProvider, SettingsDialogShell, ExecutionTab, InstructionsTab,
  NotificationsTab, PrivacyTab, LanguageTab, MemorySettingsPanel, Workspace,
  AboutPanel, AdminByokMigrationPrompt, AdminByokKeyFooter, AdminByokSettingsFooter.
- deps: dictionaries, locales, instruction/execution defaults, app/capability/
  workspace translators, navigate, createSettingsTabChange, provider presets,
  desktop check, defaultLocalAgentId (the original vendor choice remains host
  data), scope keys, product interpolation vars, probe/footer error/copy helpers,
  browser-agent translator, memoryUnavailableNote, localCliDataAttribute,
  legacySkillsPath, legacyAppearancePath, now (Date.now).
- Preserve the exact memory note, data attribute, legacy URLs and host About
  version/copy via those slots/inputs. JSX arrow adapters for the shell and
  execution component preserve explicit undefined optional props under the
  target's exactOptionalPropertyTypes contract.
- SettingsUiTabs evaluates descriptor builders in the original order. Memory
  records are projected synchronously at the original clock-read position;
  memory actions remain the shared read-only no-op.

MCP binder inputs:
- hooks: useTHook, useExternalMcpDriftCopyHook, useWiredSourceConfigListHook,
  useExternalMcpAddFormHook, useSavedAllowedToolNamesByIdHook,
  useExternalMcpAdmissionsHook, useConnect (the existing host OAuth hook),
  useKitT, useFocusTrap, useExternalMcpToolsModalEscape,
  useExternalMcpRemoveConfirm, useHostExternalMcpSharedChoice.
- kit: Icon, InfoTip, SourceConfigAddForm, SourceConfigItemCard,
  ExternalMcpSharedChoice, ExternalMcpToolsModal, ExternalMcpRemoveConfirmDialog,
  ConfirmActionDialog.
- deps: buildExternalMcpCardHandles, buildExternalMcpFieldSpecs,
  sourceDisplayLabel, isBuiltInExternalMcpSource, externalMcpNeedsSignIn,
  resolveExternalMcpEffectiveTransport, resolveExternalMcpEffectiveAuthMode,
  parseSavedToolNames, grantWriteFieldValue, describeDriftHeadline,
  buildExternalMcpRemoveConfirmCopy, EXTERNAL_MCP_DRIFT_COPY,
  EXTERNAL_MCP_PICKER_COLLABORATORS, EXTERNAL_MCP_PRODUCT_VARS,
  EXTERNAL_MCP_ADD_FORM_HANDLE.
- The existing add-form hook already captures the underlying source-add hook;
  no duplicate add-form lifecycle is introduced. Modal, shared-choice and remove
  children receive their existing explicit hook/kit references.
- Existing dependencies, showTitle and saveStatusLabel mount props are retained.
  Raw fixtures supply grouped required kit/hooks/deps. Both original screens'
  defaulted live hooks are gone.

Named Settings mutation: SETTINGS_ACCEPT_LEGACY_TAB, in SettingsUiShell:
replace the membership-checked requestedTabId with tabId ?? undefined. The new
legacy/fallback assertions must fail. The same case checks both legacy redirects,
valid tab control, scrolling, locale sync, localized Saved feedback and tab URL
replacement. NOT EXECUTED.

Named panel mutation: EXTERNAL_MCP_PROBE_BEFORE_TOOLS, in ExternalMcpSourceTools:
remove the toolsOpen condition so the modal mounts while closed. The new case's
initial probe-not-called assertion must fail; opening checks the exact server
and saved tool names. NOT EXECUTED.

Retained adm-other mutation: EXTERNAL_MCP_LOST_UPDATE, in the existing
external-mcp-source-actions.ts: remove expectedVersion from updateSource's body.
The inherited conflict case asserts version 7, retained last-known row, no restart
and no probe. NOT EXECUTED. That production controller was not changed here.

## Final review and verification limits

- Three new cases; existing test count in these three files 14 -> 17. No inherited
  test was deleted, skipped or weakened. DOM cases opt into jsdom per-file without
  changing package environment defaults, exclusions or thresholds.
- Source parsing reports zero syntax diagnostics in all nine changed/new source
  and test files. This is not a typecheck or a test result.
- Production file sizes: core settings-tabs 67, SettingsUi 270,
  SettingsUiTabs 408, ExternalMcpSettingsPanel 278, ExternalMcpSourceRow 298,
  ExternalMcpPanelSections 127 lines including final newline. Named production
  functions are <=50 lines; the moved decisions are within complexity 10 by
  source inspection. No new loops, retries or validation paths were added.
- New production imports are only React, core and the owning package. No package
  dependency edges were added. Both public manifests have browser entries.
- No product-name text occurs in the added production leaves or changed core
  entry. Product-specific historical comments remain in the unchanged host;
  neutral rationale is retained with the moved statements.
- git diff --check is clean. All changes remain in the working tree.
- Architecture audit: PASS by static source/manifest inspection. Runtime and
  semantic type evidence are reserved for Opus; no green-test claim is made.
- Function review: codec adapter — preserves denial/write/event ordering;
  Settings view/builders — preserve unconditional hooks, gate and descriptor order;
  MCP row/sections — preserve idle OAuth, conditional picker and confirmation gate.
  All are directly reached by the named fakes. No additional behaviors were built.

## Final diff removals

No tracked files were deleted. Removed my provisional untracked
.changeset/y5p-set-shell-lib.md, updating the sheet's existing changeset instead.
Removed my extra MCP removal assertions/fake controls because they exceeded this
job's named test cases. Removed unused destructured values from generated splits.
Kept Settings execution/view split exports private to SettingsUiTabs instead of
expanding the requested public SettingsUi leaf's exports. Removed unused optional
hook-override options from both new binders; raw views already provide the named
required-hook test seams.

## Tovu coordinator work still required

This job changes Jini only. Reduce the three assigned host files to G3 bindings,
wire the exact host constants/copy/styles and required hooks, repoint the named
raw fixture/source-probe imports, prune their literal-copy baseline rows, and add
only their final anchored rules inside plans/count-1125/y5-adm-keeps.md's existing
Keep rules text fence. No G3 completion or counter reduction is claimed here.
Run the three named test files and recorded mutations in the authorized Opus run.
