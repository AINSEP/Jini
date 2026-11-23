# sites (admin screens)

The Sites screen's two list tabs: **All sites** (the created-site notice, the card grid with its
list toolbar, and the empty state) and **Site Trash** (recoverable sites, Restore and Delete
permanently). Markup only: every product rule (which lifecycle button a card shows, the status
pill, the registration badge, the menu, the trash buttons), the listing DTOs, the lifecycle
controller, the shared card components and both hooks stay in the host and arrive as props.

| file | what it is |
|---|---|
| `AllSitesTab.tsx` | The All sites tab: notice, empty state, prefs notice, toolbar and grid. |
| `SiteCardView.tsx` | One card: badge, default star, subtitle, serving note, menu and action row. |
| `SiteTrashTab.tsx` | Site Trash. |
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
- Kit: the `Icon` slot (`flag-triangle`, `star-filled`) through `<AdminKitProvider>`.

**Provides**: `AllSitesTab`, `SiteCardView`, `SiteTrashTab` and the port types.

**Classes** (host styles them): `jini-sites-grid`, `jini-sites-empty`, `jini-sites-empty-title`,
`jini-sites-empty-lead`, `jini-sites-empty-action`, `jini-sites-trash-card`,
`jini-sites-trash-card-head|body|name|select|actions`, `jini-site-card-flag`,
`jini-site-card-default`, `jini-site-card-display-name`, `jini-site-card-open`, `jini-status`,
`jini-status-warning`, `jini-status-neutral`, `jini-field-hint`, `jini-save-ok`, `jini-notice`,
`jini-notice-error`, `jini-btn-primary`, `jini-btn-secondary`, `jini-btn-danger`. The lifecycle
button's class comes from the host's policy.

**Host binding today**: the host's admin sites feature keeps one binding module that renders these
tabs with its policy resolvers, the shared site-card kit and hooks, its preview address and its
empty-state copy; its Sites screen renders the bound tabs.

**Must never import**: host app code, host copy, host routes, an API client, or a UI package.
