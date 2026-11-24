# screens/dashboard

The admin landing screen — the ungrouped, top-row **Dashboard** entry: four stat cards, the
Appearance card, the default-password and site-key banners, and the "Recently updated" accordion.

| file | what it is |
|---|---|
| `Dashboard.tsx` | Markup only; every hook, action and link is a required prop. |
| `hooks/use-dashboard.hooks.ts` | `useDashboard(dependencies)` — five stat reads plus two advisory reads, each with its own error slot. |
| `hooks/dashboard-port.hooks.ts` | `DashboardPort`, what the hook reads from the outside world. |
| `hooks/fake-dashboard-port.ts` | `createFakeDashboardPort` — the in-memory port for tests. |
| `dashboard-view.types.ts` | `DashboardActivityRow`/`DashboardSiteKeyState` — the narrow view the port delivers. |
| `rules.ts` | Pure logic: `mergeRecent` (newest-first merge of posts and pages), `activityRowHref`, stat meta lines, banner rules. |
| `dashboard-i18n.ts` (+ `.locales-a…f`) | `DASHBOARD_DICT` (21 locales, incl. the Publish dialog's copy), `createDashboardTranslator`, neutral `t`. |

## Wiring

Architecture: [DR-005 portable package boundaries](../../../../../docs/decisions/DR-005-portable-package-boundaries.md).

**Needs injected.** `Dashboard` takes `DashboardProps`: `useDashboardHook` (returns a
`DashboardController`), `usePublishToLiveAvailableHook`, `useRecentActivityDisclosureHook`
(a `PersistedDisclosure`, the host binds its storage key), `onPublishAll` and `links: DashboardLinks`.
`useDashboard` takes `DashboardDependencies`: `port: DashboardPort` (the host's API clients),
`locale`, `t`, `describeError` (the host client's error-to-copy base case) and
`passwordBannerDismissedKey`. Rows are structural (`DashboardActivityRow`), so a host's richer post
type satisfies the port as is. The active-theme name comes through the port's `getPresentation`.

**Provides.** The screen, `useDashboard`, `createFakeDashboardPort`, the rules, and the dictionary
(`createDashboardTranslator({ commonDictionary })` for a host whose common words name its product).

```tsx
const useWiredDashboard = () => {
  const locale = useHostLocale();
  const t = (key: string) => translateDashboard({ locale, key });
  return useDashboard({ port: hostDashboardPort, locale, t, describeError, passwordBannerDismissedKey: "host.admin.pw-banner" });
};
<Dashboard useDashboardHook={useWiredDashboard} usePublishToLiveAvailableHook={useCanPublish}
  useRecentActivityDisclosureHook={() => usePersistedDisclosure({ storageKey: "host.admin.recent.open" })}
  onPublishAll={() => requestPublish({})} links={{ ...hostRoutes, activityRow: activityRowHref }} />
```

**Never imports** a host's API clients, stores, locale hook, router or theme code, or any product
string; only `@jini-ai/core`, `@jini-ai/ui` and this package's own `shell/`.

Classes are `jini-dash-*` and `jini-dashboard-page`; the host styles them. The page chrome classes
(`page-header`, `notice`, `btn-primary`, `empty-state`) are the shell's shared ones.
