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
  stored-key endpoint pin), `presets` (the host's provider catalog), `defaultPresetId`,
  `preferredModel` (the server's own default model) and `createExecutionPort` (the probe transport).
  The host binds all of these once in its visitor-credential-form dependencies hook file
  (`useWiredVisitorCredentialForm` / `useHostVisitorCredentialForm`).

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

**Host binding files**: the admin's ai-assistant feature binds these in its
`assistant-owner-grant-dependencies`, `visitor-tools-dependencies` and
`assistant-daemon-restart-dependencies` hook modules.

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
