# assistant-settings (admin screens)

Reusable pieces of the AI Assistant settings screen. Today this folder holds the on/off toggle row,
the owner-grant status footer, the locale-sync hook, the owner-grant hook, and the "Visitor tools"
tab (panel plus its controller and limits-draft hooks). The screen itself, the credential-form hook
and all product copy (rollout, tabs, roadmap, provider catalog, translations) still live in the host
and arrive here as props or through `t`. The settings DTOs live in
`@jini-ai/core/contracts/site/api-ai-assistant-api-types`. The daemon restart control uses
`useProcessRestart` from `@jini-ai/admin/react` rather than a copy here.

## Wiring

Architecture: [DR-005 portable package boundaries](../../../../../docs/decisions/DR-005-portable-package-boundaries.md).

**Needs injected**
- `AssistantToggleRow`: `t` (translator, used for the `"More info: {name}"` trigger name) and
  `InfoTip: ComponentType<InfoTipProps>` (the host's ⓘ widget; `InfoTipProps` from `@jini-ai/admin/react/kit`).
- `OwnerGrantStatus`: `t` plus the busy key and the load/save error strings.
- `useAiAssistantLocaleSync`: `{ locale, activeLocale, setLocale }` — the host binds its own i18n
  provider's `{ locale, setLocale }`.
- `useAssistantOwnerGrant` / `useAssistantOwnerGrantSettings`: the grant's port, namespace, cache key
  and copy (`title`, `dangers`, `confirmLabel`, `failure`, `t`) plus `OwnerGrantDependencies` —
  `useConfirmation` (the confirmation hook, e.g. `useConfirmRequest`), `refresh` (`subscribe`/`publish`
  of the settings-refresh bus) and `describeError` (the host's error-to-copy rule).
- `VisitorToolsPanel` (all REQUIRED): `t`, `useVisitorToolsHook` (the host's bound `useVisitorTools`),
  `useVisitorToolLimitsDraftHook`, `InfoTip` and `Segmented` (a radio pill matching
  `VisitorToolSegmentedProps`). `useVisitorTools` takes `VisitorToolsDependencies`: `port`,
  `namespace` (the settings-ledger namespace the policy is stored under), `isConflict` (recognises
  the 409 revision conflict) and `describeError`.

- `VisitorAssistantPanel`: `controller` (`settings`, `saving`, `saveError`, `setPublicEnabled`,
  `setWidget`), `t`, `InfoTip`, `CredentialForm` (the host's form markup), and two REQUIRED hooks:
  `useVisitorCredentialFormHook` (the host's wired credential hook) and `useVisitorAssistantPanelHook`
  (normally `useVisitorAssistantPanel` from this folder).
- `useVisitorCredentialForm(deps, { executionPort? })`: `deps` is `VisitorCredentialFormDependencies`
  — `port` (get/set site credential), `rules` (`describeApiError`, `describeProbeError`,
  `storedKeyIsForOtherEndpoint`, `hasUsableKey`, `storedKeyBlocksProbe` — the host's error copy and
  stored-key endpoint pin), `presetRules` (`groupPresets`, `isProviderConfigured`,
  `nextConfigForPresetSelect`, `resolveSelectedPreset` — the host's UI library's preset rules, bound
  with `satisfies VisitorPresetRules`), `presets` (the host's provider catalog), `defaultPresetId`,
  `preferredModel` (the server's own default model) and `createExecutionPort` (the probe transport).
  The host binds all of these once in its visitor-credential-form dependencies hook file
  (`useWiredVisitorCredentialForm` / `useHostVisitorCredentialForm`). The BYOK form shapes
  (`ByokConfig`, `ExecutionPort`, `ConnectionTestState`, `ModelDiscoveryState`, `ApiProtocol`) are
  local structural copies in `visitor-credential-form-port.ts`; `ProviderPreset` is core's catalog
  shape. The two Save presses share the admin kit's `useSerialWrites` lane, so the hook needs
  `<AdminKitProvider>` above it.
- `AdminAssistantSwitch` (all REQUIRED): `t`, `InfoTip` and `useAdminAssistantSwitchHook`
  (normally `useAdminAssistantSwitch` from this folder, which reads this package's assistant-dock bus).
- `AssistantDaemonRestart` (all REQUIRED): `t`, `description` (the host's explainer copy — it names the
  product's own automatic retry), `useAssistantDaemonRestartHook` (the host's bound `useProcessRestart`
  from `@jini-ai/admin/react`) and `useRestartAllowedHook` (the host's Local CLI execution-policy
  verdict; `false` renders nothing).
- `AdminSubagents` (all REQUIRED): `t`, `InfoTip`, `copy` (`AdminSubagentsCopy`: the master's ⓘ
  explainer, the tool-sources hint and a per-agent MCP explainer — product policy text) and
  `useAdminSubagentsHook` (the host's wired Full CLI access controller satisfying
  `AdminSubagentsController` from `admin-subagents.types`; the capability list, consent copy and
  port stay in the host).
- `AdminPermanentDeletes` (all REQUIRED): `t`, `InfoTip`, `copy` (`info`, `noAdminScreen`) and
  `useAdminPermanentDeletesHook` (normally `useAdminPermanentDeletes` from this folder bound to the
  host's policy). `useAdminPermanentDeletes` takes `OwnerGrantDependencies`, a `SiteGrantPort` and a
  `PermanentDeletesPolicy` — `namespace`, `key`, `tools` (id/label/group/adminPath), `groupLabels`,
  `title`, `dangers`, `confirmLabel`, `failure`.
- `VisitorAssistantTabs` (all REQUIRED): `t`, `providerPanel`, `toolsPanel` (the host's wired
  `VisitorToolsPanel`), `useVisitorAssistantTabsHook` (normally `useVisitorAssistantTabs` from this
  folder), `useTabBarKeyboardHook` and `resolveTabIndex` (the host UI library's TabBar keyboard hook
  and roving-tabindex rule, typed by this package's kit). The segmented-pill look is the host's
  `jini-chat-settings-segmented` stylesheet.
- `useAiAssistant(deps)`: `deps.port` (`AiAssistantPort` — get/set the public assistant settings) and
  `deps.describeError` (the host's error-to-copy rule). Uses the kit's query hooks, so it needs
  `<AdminKitProvider>` above it.

**Provides**
- `AssistantToggleRow` — checkbox or `role="switch"` row; classes `jini-assistant-toggle`,
  `jini-assistant-toggle--switch`, `jini-assistant-toggle-head`, `jini-assistant-toggle-copy` (host styles them).
- `OwnerGrantStatus` — busy `status` line plus `jini-save-error` alerts.
- `useAiAssistantLocaleSync` — keeps a mounted provider's locale equal to the host's live locale.
- `VisitorAssistantPanel` — status pill and three numbered steps; classes `jini-visitor-assistant`,
  `jini-visitor-status(-caption|-hint)`, `jini-visitor-pill` + `jini-visitor-pill--{on|off|needs-key}`,
  `jini-visitor-steps`, `jini-visitor-step(-head|-title|-hint)`, `jini-visitor-compact-select`,
  `jini-save-error` (host styles them). Also `createVisitorMoreInfo`.
- `use-visitor-assistant-panel.hooks` — `useVisitorAssistantPanel`, `visitorAssistantStatus`, `VISITOR_STATUS_COPY`.
- `use-visitor-credential-form.hooks` — `useVisitorCredentialForm` (state + hydration; the two automatic
  discovery effects live in `use-visitor-credential-discovery.hooks.ts`, internal).
- `visitor-credential-form-actions` — `saveVisitorKey`, `saveVisitorSettings`, `runVisitorKeyTest`,
  `runVisitorTestConnection` (each takes the host's describer).
- `visitor-credential-form.rules` — pure rules over an injected `presets` catalog
  (`isPresetSuppliedEndpoint` security gate, `configuredPresetIds`, `hydrateVisitorCredentialConfig`,
  `defaultVisitorCredentialConfig`, `visitorProviderGroups`, `withDiscoveredModel`, …).
- `visitor-credential-form-port` — `VisitorCredentialFormPort`, `VisitorCredentialFormRules`,
  `VisitorCredentialFormDependencies`, `VisitorCredentialFormController`, `SaveState` (types only).
- `useAssistantOwnerGrant` — consent-gated, locked, non-optimistic save of a site-owner grant; a
  successful save replaces the shared query and publishes a refresh naming its namespace.
- `VisitorToolsPanel` — per-tool Auto | Ask first | Off plus Save-only limits; classes
  `jini-visitor-tools*`, `jini-visitor-tool*`, `jini-visitor-tools-message--{warning,conflict,error}`
  (host styles them; buttons reuse the host's `btn-primary`/`btn-secondary`).
- `AdminAssistantSwitch` — the dock open/close row; class `jini-assistant-switch` (host styles it).
- `use-admin-assistant-switch.hooks` — `useAdminAssistantSwitch` (live `useSyncExternalStore` read of
  the dock bus; `setOpen` is a request, never a write).
- `AssistantDaemonRestart` — Restart / Check status buttons, result and status lines; classes
  `jini-assistant-daemon-restart(-actions)`, `jini-assistant-muted`, `jini-assistant-save-line`,
  `jini-save-error` (host styles them; buttons reuse `btn-secondary`). Also
  `assistantDaemonStatusMessage`, `assistantRestartResultMessage`.
- `AdminSubagents` — Full CLI access switch plus per-agent personal-MCP rows; classes
  `jini-assistant-switch`, `jini-assistant-subagents`, `jini-assistant-tool-sources`,
  `jini-assistant-grant-note` (host styles them).
- `AdminPermanentDeletes` — master switch, consent dialog and autosaving per-tool checklist; classes
  `jini-assistant-switch`, `jini-assistant-permanent-deletes`, `jini-permanent-delete-actions`,
  `jini-permanent-delete-option`, `jini-assistant-grant-note` (buttons reuse the host's `btn-ghost`).
- `use-admin-permanent-deletes.hooks` — `useAdminPermanentDeletes`, `PermanentDeletesPolicy`,
  `PermanentDeleteTool`, `PermanentDeletesSettings` (turning OFF keeps the selection; checklist
  commands are inert while OFF or unloaded).
- `VisitorAssistantTabs` + `use-visitor-assistant-tabs.hooks` — the "AI provider | Visitor tools"
  segmented tablist; class `jini-visitor-assistant-tabs`.
- `use-ai-assistant.hooks` — `useAiAssistant`, `AiAssistantPort`, `AiAssistantDependencies`,
  `AiAssistantController` (non-optimistic: the screen re-renders from the server's response).

**Host binding files**: the admin's ai-assistant feature binds these in its
`assistant-owner-grant-dependencies`, `visitor-tools-dependencies` and
`assistant-daemon-restart-dependencies` hook modules; the screen file itself binds the dock switch,
the restart gate (its `useHostAssistantRestartAllowed`) and the wired settings hook (`useWiredAiAssistant`). The permanent-deletes policy and port are bound in its `permanent-deletes-dependencies` hook
module, the Full CLI access controller stays in its `use-admin-subagents` hook module, and both
screens' product copy and bound props live in its `owner-grant-bindings` module.

**Host wiring example**

```tsx
import { InfoTip, useI18n } from "./host-ui"; // the host's own tip widget and i18n provider hook
import { AssistantToggleRow } from "@jini-ai/admin/screens/assistant-settings/AssistantToggleRow";
import { useAiAssistantLocaleSync } from "@jini-ai/admin/screens/assistant-settings/use-ai-assistant-locale-sync.hooks";

function useWiredLocaleSync({ locale }: { locale: string }) {
  const { locale: activeLocale, setLocale } = useI18n();
  useAiAssistantLocaleSync({ locale, activeLocale, setLocale });
}
<AssistantToggleRow t={t} InfoTip={InfoTip} label={t("Full CLI access")} info={t("…")} checked={on} onChange={save} />
```

**Must never import**: host app code, host copy, an i18n provider implementation or a tip-widget
implementation (only the `InfoTipProps` type from this package's kit and the `AgentHandleProps`
type from `@jini-ai/core/agent-handles`).
