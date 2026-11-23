# site-card

The shared site card (`SiteCard`, `SiteCardStatus`, `SiteCardPin`), the list toolbar and list view
(`SiteListToolbar`, `useSiteListView`, `useSiteListPrefs`), and the card's preview image
(`useSiteCardPreview`, `resolveSiteCardPreview`), and the return to the list after a create
(`useReturnToSiteListOnCreate`). Public entry: `@jini-ai/ui/site-card`; styles:
`@jini-ai/ui/site-card.css`. Class names are `jini-site-card*`.

## Wiring

Why the boundary is drawn this way: [DR-005 portable package boundaries](../../../../../docs/decisions/DR-005-portable-package-boundaries.md).

**Needs injected**

- `SiteListPrefsPort` — where the host stores each person's list preferences (`useSiteListPrefs`).
- `SiteCardPreviewUrl` — the host-built address of a site's captured preview at a version
  (`useSiteCardPreview` / `resolveSiteCardPreview`, required `urlFor`).
- `useReturnToSiteListOnCreate`'s status and address: `createdName` (the host controller's last
  successful create, or `null`) and `returnToList` (the host's stable navigation to its list tab).
  The host's Sites screen binds both.
- Copy/labels and the listing snapshot (`SiteCardPreviewSnapshot`: `previewVersions` per site name).

**Provides** the card frame, status pill, pin, toolbar, list view/prefs state, and the preview `src`
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

**Never imports** host routes, URL builders, workspace ids, product strings, or another package's
implementation; host data reaches it only through the args above.
