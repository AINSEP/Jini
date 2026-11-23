# Observability screen

Operations > Observability: OpenTelemetry status (Overview), the newest server errors (Recent
errors), the monitoring-provider placeholder (Providers), the owner-only tool-gap audit (Tool gaps)
and, for an authorized TanStack host, the live query cache (Queries). `QUERIES.md` explains the
Queries tab.

## Wiring

Architecture: [DR-005 portable package boundaries](../../../../../docs/decisions/DR-005-portable-package-boundaries.md)
(also DR-002/DR-003). This screen renders under `<AdminKitProvider>` and reaches its UI library only
through the kit (`I18nProvider`, `SettingsDialogShell`, `useFetchQuery`, `SETTINGS_DIALOG_DICTIONARIES`).

**The host injects (all required `ObservabilityProps`):**
- `productName` — fills the `{product}` placeholder in the screen's copy.
- `useObservabilityStatusHook` — `useObservabilityStatus({ port, locale, t, describeError })` bound to
  `createObservabilityStatusPort({ api })`.
- `useRecentServerErrorsHook` — `useRecentServerErrors({ port, locale, t, describeError })` bound to
  `createRecentServerErrorsPort({ api, clipboard })`.
- `useRecentErrorItemHook` (`RecentErrorItemHook`) — one row's expand/copy-feedback state.
- `useQueriesTabHook` — `useQueriesTab({ adapter, port }, { development })` bound to the host's identity read.
- `QueryCachePanel` — the vendor cache panel the Queries tab embeds (lazy).
- `readToolGaps` (`ToolGapsRead`) — the host-bound `api.getToolGaps`.
- `useAdminThemeBoundaryHook`, `useObservabilityTabHook` — the host's theme boundary and tab/URL adapter.
- `api` = `createObservabilityApi({ request, workspaceId })`: `request` is the host's authenticated
  admin request (`ObservabilityAdminRequest`).
- CSS: the host imports `recent-errors.css` (and its settings-dialog stylesheet) once.

**It provides:** the `Observability` component, the API factory, the ports and their in-memory fakes
(`createFake*Port`), the state hooks, and the `observability-i18n` dictionary (on `ADMIN_COMMON_I18N`).

```tsx
const api = createObservabilityApi({ request, workspaceId: WORKSPACE_ID });
const statusPort = createObservabilityStatusPort({ api });
function useStatus() {
  const locale = useAdminLocale();
  return useObservabilityStatus({ port: statusPort, locale, t: key => t({ locale, key }), describeError: describeApiError });
}
<Observability tabId={tabId} productName="My Site" useObservabilityStatusHook={useStatus}
  useRecentServerErrorsHook={useErrors} useRecentErrorItemHook={useRow} useQueriesTabHook={useQueries}
  QueryCachePanel={LazyDevtools} readToolGaps={() => api.getToolGaps()}
  useAdminThemeBoundaryHook={useThemeBoundary} useObservabilityTabHook={useTabUrl} />
```

**Never imports:** host paths, the host's HTTP client, a UI library package directly (only the
admin kit), a query-library devtools package, or host theme hooks.
