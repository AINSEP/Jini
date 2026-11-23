# `@jini-ai/admin/pages`

The theme-neutral, host-neutral leaves of the admin Pages screen. The screen itself (`Pages`,
`PageEditor`, its controller hook, ports and dependency wiring) still lives in the host; it imports
these subpaths directly. Theme pieces (theme canvas, theme pages tab) stay in the host by design.

| Subpath | Provides |
|---|---|
| `pages/api/pages-api.types` | `AdminPagePluginEmbed` — a plugin embed row the page editor offers. |
| `pages/hooks/pages-tab-url.hooks` | `resolvePagesTabFromUrl` / `writePagesTabToUrl` / `PagesTabId` — the Pages screen's `?tab=` deep link. |
| `pages/Pages.hooks` | `createPagesTabSelect` — tab select handler that also writes the URL. |
| `pages/lib/page-preview-youtube` | `pagePreviewYoutubeIds` — YouTube ids in page HTML for the preview. |
| `pages/lib/prettify-html` | `prettifyHtml` — whitespace-only, render-invisible HTML formatter for the editor's HTML tab. |
| `pages/lib/embed-placeholder` | `isProtectedEmbedElement`, `createEmbedPlaceholderDescriber`, `EmbedMarkerReaders`, `EmbedMarkerTarget` — the editor canvas's embed-marker protection and card labels. |
| `pages/pages-i18n` | `PAGES_DICT`, `t` — the Pages list screen dictionary (all locales), falling back to `ADMIN_COMMON_I18N`. |

## Wiring

Injected: `createEmbedPlaceholderDescriber` needs the two CMS marker readers
(`EmbedMarkerReaders`: `parseEmbedMarkerConfig`, `embedMarkerTarget`) as fields of its required
args, because `@jini-ai/admin` has no runtime dependency on `@jini-ai/cms`. Everything else is pure
or reads only `window.location`/`history` (the tab URL hook).

```ts
import { embedMarkerTarget, parseEmbedMarkerConfig } from "@jini-ai/cms/widgets/markers";
import { createEmbedPlaceholderDescriber, isProtectedEmbedElement } from "@jini-ai/admin/pages/lib/embed-placeholder";

const describeEmbedPlaceholder = useMemo(
  () => createEmbedPlaceholderDescriber({ t, parseEmbedMarkerConfig, embedMarkerTarget }, { pluginEmbeds: () => pluginEmbeds.current }),
  [t],
);
<HtmlEditor isProtectedElement={isProtectedEmbedElement} describeEmbedPlaceholder={describeEmbedPlaceholder} … />
```

Must never import: host application code (`@/…`, app paths), `@jini-ai/cms` or `@jini-ai/ui`
implementation (types come from `../react/kit.js`; implementations are injected), theme host code,
or product copy. A host whose common words name its product composes its own entries over
`ADMIN_COMMON_I18N`; they never enter `pages-i18n`.

Why: [DR-005 portable package boundaries](../../../../docs/decisions/DR-005-portable-package-boundaries.md),
[DR-003 single-owner UI effects](../../../../docs/decisions/DR-003-single-owner-ui-effects.md).
