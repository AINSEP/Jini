# sites (admin screens)

The Sites screen's two list tabs: **All sites** (the created-site notice, the card grid with its
list toolbar, and the empty state) and **Site Trash** (recoverable sites, Restore and Delete
permanently). Markup only: every product rule (which lifecycle button a card shows, the status
pill, the registration badge, the menu, the trash buttons), the shared card components and both
card hooks stay in the host and arrive as props. The listing read (`useSitesSnapshot`) and the
lifecycle controller (`useLocalSites`) live here; the host calls them with its injected keys, copy
and rules and hands the controller to the tabs as a prop.

| file | what it is |
|---|---|
| `AllSitesTab.tsx` | The All sites tab: notice, empty state, prefs notice, toolbar and grid. |
| `SiteCardView.tsx` | One card: badge, default star, subtitle, serving note, menu and action row. |
| `SiteTrashTab.tsx` | Site Trash. |
| `sites-list-rules.ts` | The neutral list rules: `resolveSitesEmpty`, `resolveSitesRowHandles`, `resolveSiteListItems`, `resolveSiteSubtitle`, `resolveTrashCardActions` (and `resolveTrashDeleteDisabled`). The host passes them into its policies. |
| `use-site-confirm.hooks.ts` | `useSiteConfirm`: promise-shaped confirm for the host's local-sites controller, titled per action from the host's injected presentation table. |
| `LocalSiteConfirmDialog.tsx` | The one always-mounted `ConfirmDialog` that renders a `useSiteConfirm` controller's open request. |
| `sites-port.hooks.ts` | Types only: `SitesPort`, the list/create/activate/token-plugin/local-lifecycle port over the Core DTOs (`@jini-ai/core/contracts/site/admin-sites`). |
| `use-sites-snapshot.hooks.ts` | `useSitesSnapshot`: the shared cached site-list read (screen and sidebar), scoped by principal, refetched on a content-refresh notice for the host's resource. |
| `use-local-sites.hooks.ts` | `useLocalSites`: the local lifecycle controller (confirm, guard double clicks, write, restart/start polling, error copy). |
| `sites-screen-ports.ts` | Types only: the structural site/snapshot shapes, `AllSitesPolicy`, `SiteTrashPolicy`, `SitesLifecycleController`, `SitesCardKit`, and the two hook types. |

## Wiring

Architecture: [DR-005 portable package boundaries](../../../../../docs/decisions/DR-005-portable-package-boundaries.md).

**Needs injected** (all REQUIRED unless noted)
- `policy: AllSitesPolicy` / `policy: SiteTrashPolicy` — the host's card and trash rules, as plain
  functions (the host passes its own resolvers; their narrower DTO types bind to the method shapes).
- `useSiteListViewHook` — the host's list-view hook (sort, filter, pins, hidden), called once per
  grid render as `props.useSiteListViewHook(...)`; its controller type flows to `cardKit.SiteListToolbar`.
- `useSiteCardPreviewHook` and `previewUrlFor` — the card-preview hook and the host's preview address.
- `cardKit: SitesCardKit` — the shared site-card components (`SiteCard`, `SiteCardPin`,
  `SiteCardStatus`, `SiteListToolbar`). This package imports no UI package; the host passes them.
- `emptyState: { leadKey, newSiteHref }` — the host's empty-state lead (a translation key) and the
  address of its "New site" tab.
- `listPrefs`, `localSites?` / `controller?`, `snapshot`, `sites`, `t` — the host controller's state.
- `useSiteConfirm({ t, presentation })` — `presentation` is REQUIRED: the host's per-action title and
  confirm-label translation keys and tone (host copy stays in the host). The host calls this hook
  inside its own sites controller and hands the result to `LocalSiteConfirmDialog` as `dialog`
  (optional; it renders nothing without one). `LocalSiteConfirmDialog` calls no hook of its own
  beyond the shared `ConfirmDialog`, which needs the kit (`<AdminKitProvider>`).
- The list rules in `sites-list-rules.ts` are plain functions; the host imports them and places
  them in its `AllSitesPolicy` / `SiteTrashPolicy` next to its own product rules.
- `useSitesSnapshot({ port, listing })` — `port.listSites` and `listing: { listKey, resource }`, the
  host's site-list cache key and its content-refresh resource name. Needs the kit's query slot
  (`useFetchQuery`/`useInvalidate`) and reads the admin boot scope.
- `useLocalSites({ port, snapshot, t, deps })` — `deps: LocalSitesDeps` is REQUIRED: the host's list
  key, its confirmation copy key per action (`confirmKeys`), its chat-running warning key, its
  write-error rule (`siteWriteErrorKey`), its shared `describeApiError` fallback, and a
  visibility-aware `startVisibleInterval`. Optional: `confirm` (defaults to the browser's),
  `visibility`, `timers`.
- `useSitesConfig({ port, listKey, useAsyncActionHook })` — all REQUIRED: `port: SitesConfigPort`
  (`getSitesConfig`/`setSitesConfig`, the host's local sites settings read and write), `listKey`
  (the host's site-list cache key, invalidated after every successful write) and
  `useAsyncActionHook` (the host's saving/error action hook, e.g. the shared panel kit's
  `useAsyncAction`; this package imports no UI package). Needs the kit's query slot (`useInvalidate`).
- Kit: the `Icon` slot (`flag-triangle`, `star-filled`) through `<AdminKitProvider>`.

**Provides**: `AllSitesTab`, `SiteCardView`, `SiteTrashTab`, `LocalSiteConfirmDialog`,
`useSiteConfirm`, `useSitesSnapshot`, `useLocalSites`, `useSitesConfig`, `SitesPort`, `SitesConfigPort`, the list rules and the port types.

**Classes** (host styles them): `jini-sites-grid`, `jini-sites-empty`, `jini-sites-empty-title`,
`jini-sites-empty-lead`, `jini-sites-empty-action`, `jini-sites-trash-card`,
`jini-sites-trash-card-head|body|name|select|actions`, `jini-site-card-flag`,
`jini-site-card-default`, `jini-site-card-display-name`, `jini-site-card-open`, `jini-status`,
`jini-status-warning`, `jini-status-neutral`, `jini-field-hint`, `jini-save-ok`, `jini-notice`,
`jini-notice-error`, `jini-btn-primary`, `jini-btn-secondary`, `jini-btn-danger`. The lifecycle
button's class comes from the host's policy.

**Host binding today**: the host's admin sites feature keeps one binding module that renders these
tabs with its policy resolvers, the shared site-card kit and hooks, its preview address and its
empty-state copy (the list rules come from `sites-list-rules.ts`); its Sites screen renders the
bound tabs and `LocalSiteConfirmDialog`; its sites controller hook calls `useSiteConfirm` with its
presentation table. The host's sites dependency module binds the rest: its live and fake
`SitesPort`, the confirmation copy and presentation tables, `SITES_LISTING` for `useSitesSnapshot`
(also read by its sidebar label, section availability and import/export page), and `localSitesDeps`
for `useLocalSites`, and a bound `useSitesConfig` (its API client, list key and `useAsyncAction`)
that its sites-settings component takes as its `useSettings` default. The listing and settings DTOs are Core's `contracts/site/admin-sites`.

**Must never import**: host app code, host copy, host routes, an API client, or a UI package.
