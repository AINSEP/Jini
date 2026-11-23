# screens/analytics

The admin "Analytics" screen: a raw recent-hits table (newest first) with a "not a dashboard yet"
notice and a Cookie Consent cross-link. Markup in `Analytics.tsx`; state in `useAnalytics`.

| file | what it is |
|---|---|
| `Analytics.tsx` / `index.ts` | The screen; `index.ts` is the only surface a host router imports. |
| `analytics-i18n.ts` | 21-locale dictionary, keyed by the English sentence, over `ADMIN_COMMON_I18N`. |
| `api/analytics-api.types.ts` | `AdminAnalyticsHit`, the wire row. |
| `hooks/analytics-port.hooks.ts` | `AnalyticsPort` — what `useAnalytics` needs from the host. |
| `hooks/analytics-dependencies.hooks.ts` | `createFakeAnalyticsPort` (the in-memory fake). |
| `hooks/use-analytics.hooks.ts` | `useAnalytics({ port, t })` → `AnalyticsController`. |

## Wiring

- **Needs injected:** `AnalyticsProps.useAnalyticsHook: () => AnalyticsController` (required, no
  default). The host composes it from `useAnalytics` with its own `AnalyticsPort` (its admin request
  client + workspace id) and a `t` bound to its admin-locale hook.
- **Provides:** `Analytics`, `useAnalytics`, `AnalyticsController`, `AnalyticsPort`,
  `createFakeAnalyticsPort`, `AdminAnalyticsHit`, and the dictionary's `t({ locale, key })`.
- **Host wiring example:**

```ts
import { Analytics } from '@jini-ai/admin/screens/analytics';
import { useAnalytics } from '@jini-ai/admin/screens/analytics/hooks/use-analytics.hooks';
import { t as analyticsT } from '@jini-ai/admin/screens/analytics/analytics-i18n';

const port = { listRecentAnalyticsHits: (_r = {}, o = {}) => hostApi.recentHits(o) };
function useWiredAnalytics() {
  const locale = useHostAdminLocale();
  return useAnalytics({ port, t: ({ key }) => analyticsT({ locale, key }) });
}
// <Analytics useAnalyticsHook={useWiredAnalytics} />
```

- **Must never import:** a host HTTP/request client, a workspace id constant, a host locale hook,
  or any host theme CSS. The `jini-*` class names are styled by the host.

Architecture: `docs/decisions/DR-005-portable-package-boundaries.md`.
