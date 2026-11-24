# site-card

The shared site card (`SiteCard`, `SiteCardStatus`, `SiteCardPin`), the list toolbar and list view
(`SiteListToolbar`, `useSiteListView`, `useSiteListPrefs`, the pure `parseSiteListPrefs` rule), the card's preview image
(`useSiteCardPreview`, `resolveSiteCardPreview`), and the return to the list after a create
(`useReturnToSiteListOnCreate`). Public entry: `@jini-ai/ui/site-card`; styles:
`@jini-ai/ui/site-card.css`. Class names are `jini-site-card*`.

## Wiring

Why the boundary is drawn this way: [DR-005 portable package boundaries](../../../../../docs/decisions/DR-005-portable-package-boundaries.md).

**Needs injected**

- `SiteListPrefsPort` — where the host stores each person's list preferences:
  `useSiteListPrefs({ port }, { describeError?, seed?, immediateFirstSave? })`. `port.load()` reads the
  stored choices (async); `port.save({ next })` writes one change and may return nothing when the
  store is synchronous. `seed` is an optional synchronous read for a store that answers at once
  (browser storage): the first render then shows the stored choices and `port.load` is never called.
  `describeError` is host wording for `loadError`/`saveError`. `immediateFirstSave` (default `false`)
  starts a change's save in the same turn when none is in flight; a host with a synchronous store sets
  it so each click is written before its handler returns. Left off, every save is queued and starts on
  the next microtask.
- `SiteCardPreviewUrl` — the host-built address of a site's captured preview at a version
  (`useSiteCardPreview` / `resolveSiteCardPreview`, required `urlFor`).
- `useReturnToSiteListOnCreate`'s status and address: `createdName` (the host controller's last
  successful create, or `null`) and `returnToList` (the host's stable navigation to its list tab).
  The host's Sites screen binds both.
- Copy/labels and the listing snapshot (`SiteCardPreviewSnapshot`: `previewVersions` per site name).

**Provides** the card frame, status pill, pin, toolbar, list view state, `SiteListPrefsController`
(`prefs`, `ready`, `onPrefsChange`, `loadError`, `saveError`; saves are ordered, and after a failed
read nothing is saved but changes still apply for the session), and the preview `src`
(or `null` for a placeholder) with an `onError` that falls back to the placeholder until a new
capture changes the URL, and one `returnToList` call per create transition (never on mount).

```tsx
import { SiteCard, useSiteCardPreview } from "@jini-ai/ui/site-card";
import "@jini-ai/ui/site-card.css";
import { previewUrl } from "./host-urls"; // host-owned route builder

function HostSiteCard({ site, snapshot }) {
  const preview = useSiteCardPreview({ site, snapshot, urlFor: previewUrl });
  return <SiteCard name={site.name} previewSrc={preview.src} onPreviewError={preview.onError} />;
}
```

**Never imports** host routes, URL builders, host storage keys, host bridges/IPC, `console`, workspace ids, product strings, or another package's
implementation; host data reaches it only through the args above.
