# assistant-settings (admin screens)

Reusable pieces of the AI Assistant settings screen. Today this folder holds the on/off toggle row,
the owner-grant status footer and the locale-sync hook. The screen itself, its settings DTOs, the
owner-grant, credential-form and visitor-tools hooks, and all product copy (rollout, tabs, roadmap,
provider catalog) still live in the host and arrive here as props.

## Wiring

Architecture: [DR-005 portable package boundaries](../../../../../docs/decisions/DR-005-portable-package-boundaries.md).

**Needs injected**
- `AssistantToggleRow`: `t` (translator, used for the `"More info: {name}"` trigger name) and
  `InfoTip: ComponentType<InfoTipProps>` (the host's ⓘ widget; `InfoTipProps` from `@jini-ai/admin/react/kit`).
- `OwnerGrantStatus`: `t` plus the busy key and the load/save error strings.
- `useAiAssistantLocaleSync`: `{ locale, activeLocale, setLocale }` — the host binds its own i18n
  provider's `{ locale, setLocale }`.

**Provides**
- `AssistantToggleRow` — checkbox or `role="switch"` row; classes `jini-assistant-toggle`,
  `jini-assistant-toggle--switch`, `jini-assistant-toggle-head`, `jini-assistant-toggle-copy` (host styles them).
- `OwnerGrantStatus` — busy `status` line plus `jini-save-error` alerts.
- `useAiAssistantLocaleSync` — keeps a mounted provider's locale equal to the host's live locale.

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
