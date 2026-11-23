# `@jini-ai/admin/pages`

The theme-neutral, host-neutral parts of the admin Pages screen: the Pages LIST screen (`Pages`,
its `usePages` hook, port and list-only rules) plus the leaves the host's `PageEditor` imports. The
editor, its controller hook and every host adapter (API-client ports, the wired `useWired*` halves)
still live in the host. Theme pieces (theme canvas, Theme Pages tab and its hook) stay in the host by
design and are injected.

| Subpath | Provides |
|---|---|
| `pages/api/pages-api.types` | `AdminPagePluginEmbed` — a plugin embed row the page editor offers. |
| `pages/hooks/pages-tab-url.hooks` | `resolvePagesTabFromUrl` / `writePagesTabToUrl` / `PagesTabId` — the Pages screen's `?tab=` deep link. |
| `pages/Pages.hooks` | `createPagesTabSelect` — tab select handler that also writes the URL. |
| `pages/lib/page-preview-youtube` | `pagePreviewYoutubeIds` — YouTube ids in page HTML for the preview. |
| `pages/lib/prettify-html` | `prettifyHtml` — whitespace-only, render-invisible HTML formatter for the editor's HTML tab. |
| `pages/lib/embed-placeholder` | `isProtectedEmbedElement`, `createEmbedPlaceholderDescriber`, `EmbedMarkerReaders`, `EmbedMarkerTarget` — the editor canvas's embed-marker protection and card labels. |
| `pages/Pages` | `Pages` (generic over the host row), `pagesListNotice`, `PagesProps`, `PagesListSorting`, `PagesListPaths`, `PagesThemeTabController` — the list screen, markup only. |
| `pages/hooks/use-pages.hooks` | `usePages`, `usePageRowMenuHandleMap`, `PagesController`, `PagesDependencies` — every piece of list state. |
| `pages/hooks/pages-port.hooks` | `PagesPort`, `PageListRow`, `PageListPatch`, `PagesEventsPort` — what the list needs from the host. |
| `pages/pages-list-rules` | `pageRowMenuItems`, `buildPageRowMenuHandleMap`, `PageRowMenuHandlers` — list-only row-menu logic. |
| `pages/pages-i18n` | `PAGES_DICT`, `t` — the Pages list screen dictionary (all locales), falling back to `ADMIN_COMMON_I18N`. |
| `pages/hooks/use-interactive-flush.hooks` | `useInteractiveEditorFlush`, `INTERACTIVE_FLUSH_TIMEOUT_MS`, `InteractiveFlushCollaborators` — folds an open Interactive-tab edit into the working copy before a save, tab switch or template change, bounded by a timeout. |
| `pages/hooks/use-editor-html-jump.hooks` | `useEditorHtmlJump`, `measureTextareaCaretTop`, `RequestEditHtml`, `FindEditorBlockOpening` — the canvas's "Edit HTML" jump to a block's exact opening tag in the HTML tab. |

## Wiring

### Pages list (`Pages` + `usePages`)

Injected (all required): `Pages` takes `usePagesHook` (the host's bound `usePages`),
`useThemePagesHook` + `ThemePagesTab` (themes stay in the host; the screen reads only
`pageCount` and hands the controller back to the tab), `PublishSectionButton`, `ServerLabel`,
`sorting: PagesListSorting<Row>` (comparators + sort labels the host shares with its Posts list) and
`paths: PagesListPaths` (`pageAdminPath`, `pagePublicPath`, `siteUrl`). `usePages` takes
`PagesDependencies<Row>`: `port: PagesPort<Row>`, `navigate`, bound `t`, `locale`,
`events: PagesEventsPort` (the host's content-refresh notification, already filtered to its pages
resource) and `pageAdminPath`. Rows are structural (`PageListRow`); the host instantiates with its
own record type. Provides the whole list screen: tabs + `?tab=` deep link, sortable table, row
menu, publish toggle, soft-delete confirm. CSS: only shared host shell classes (`page*`, `notice`,
`card`, `empty-state`, `status status-*`), so no stylesheet ships with it.

```tsx
const pagesEvents: PagesEventsPort = { subscribe: (listener) => onContentRefresh("pages", listener) };
function useWiredPages() {
  const locale = useHostLocale();
  const t = useCallback((key: string) => translate({ locale, key }), [locale]);
  return usePages({ port: hostPagesPort, navigate: (path) => navigate({ routePath: path }), t, locale, events: pagesEvents, pageAdminPath });
}
<Pages usePagesHook={useWiredPages} useThemePagesHook={useWiredThemePages} ThemePagesTab={BoundThemePagesTab}
  PublishSectionButton={PublishSectionButton} ServerLabel={ServerLabel} sorting={PAGES_SORTING} paths={PAGES_PATHS} />
```

Must never import: the host's API clients, router bindings, locale hook, content-refresh bus
filter, theme code or shared page rules — each arrives through the props/deps above.

### Editor leaves

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

`useInteractiveEditorFlush` takes `InteractiveFlushCollaborators` as required fields beside
`setHtml`: `isEditorSourceError` (`@jini-ai/ui/html-editor`; the one flush failure that propagates),
`normalizeEmbedMarkerQuoting` (`@jini-ai/cms/widgets/markers`) and a core `Logger` (`warn` receives
the two "continuing without the open edit" messages with the error in its error bag).
`useEditorHtmlJump` takes `findEditorBlockOpening` (`@jini-ai/ui/html-editor`) as a required field;
its `onError` receives the caught flush error (or nothing for a missing occurrence).

```ts
useInteractiveEditorFlush({ setHtml, isEditorSourceError, normalizeEmbedMarkerQuoting, logger });
useEditorHtmlJump({ html, contentRevision, flush, setView, setDraftHtml, scrollTop, findEditorBlockOpening }, { onError });
```

Must never import: host application code (`@/…`, app paths), `@jini-ai/cms` or `@jini-ai/ui`
implementation (types come from `../react/kit.js`; implementations are injected), theme host code,
or product copy. A host whose common words name its product composes its own entries over
`ADMIN_COMMON_I18N`; they never enter `pages-i18n`.

Why: [DR-005 portable package boundaries](../../../../docs/decisions/DR-005-portable-package-boundaries.md),
[DR-003 single-owner UI effects](../../../../docs/decisions/DR-003-single-owner-ui-effects.md).
