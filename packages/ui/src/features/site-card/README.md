# site-card

Shared site card, list toolbar and list-view state for a host's grid of sites.

- `SiteCard`, `SiteCardStatus`, `SiteListToolbar`, `SiteCardPin` — markup (`jini-site-card*` classes,
  `@jini-ai/ui/site-card.css`).
- `useSiteListView`, `useSiteListPrefs` — sort/filter/pin/hide state over an injected prefs port.
- `useSitePreview` (+ `previewFetchPlan`, `nextPreviewUrl`) — fetches a card's cached preview image
  once per distinct `previewVersion` (changed, not increased: the token is an mtime and may move
  backward); a superseded request's late reply or failure never overwrites a newer one.

## Wiring

The host injects:

- `useSitePreview({ id, previewVersion, getBridge })` — `getBridge` is the host's preload bridge lookup
  exposing `getSitePreview({ id })`; the IPC channel and the capture store stay host-owned. Pass a
  stable function (it is an effect dependency). The hook is standalone: a host card component calls it
  and hands the URL to `SiteCard` as a prop.
- `useSiteListPrefs({ port })` — the host's prefs storage port.
- Copy for `SiteListToolbar` via its `copy` prop.

The host's site-preview hook module binds `getBridge` to its preload bridge; its site grid calls that
hook per card and passes the URL into `SiteCard`.
