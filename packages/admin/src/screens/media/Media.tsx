import type { ReactNode, ComponentType, Dispatch, SetStateAction, FormEvent, MouseEvent } from "react";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import type { MediaProviderOption } from "@jini-ai/core";
import type { FetchQueryAdapter, QueryKey } from "@jini-ai/core/fetch";
import type { MediaController } from "./hooks/use-media.hooks.js";
import type { MediaPreviewController } from "./hooks/use-media-preview.hooks.js";
import type { EditMediaPanelController, EditMediaPanelHookProps } from "./hooks/use-edit-media-panel.hooks.js";
import type { useMediaGridSize } from "./hooks/use-media-grid-size.hooks.js";
import type { useMediaCardDetails } from "./hooks/use-media-card-details.hooks.js";
import type { useEditMediaModal } from "./hooks/use-edit-media-modal.hooks.js";
import type { useMediaItemLink } from "./hooks/use-media-item-link.hooks.js";
import type { useMediaCardMetadata } from "./hooks/use-media-card-metadata.hooks.js";
import type { useMediaTabs, MediaContentTabId, MediaTabId, MediaTabsController } from "./hooks/use-media-tabs.hooks.js";
import type { MediaProviderCatalogPort } from "./media-providers-port.js";
import type { AdminKitValues, AdminKitComponents } from "../../react/kit.js";
import type { RowMenuProps } from "../../react/components/RowMenu/RowMenu.js";
import type { ConfirmDialogProps } from "../../react/components/ConfirmDialog/ConfirmDialog.js";
import { MediaPageShell } from "./MediaPageShell.js";
import { MediaLibraryPanel } from "./MediaLibraryPanel.js";
import { buildAgentListHandles } from "@jini-ai/core/agent-handles";

/**
 * @file Media admin screen — list + upload + trash/purge ladder, wiring the `media` backend into
 * the admin UI. Markup only: state, effects, and API calls for all four components in this file
 * (`Media`, `MediaPreview`, `EditMediaPanel`, `MediaLightbox`) live in their own `hooks/use-<thing>
 * .hooks.ts`; computed values (alt-text fallback, the row-menu builder, the editing-item lookup,
 * the lightbox index math) live in `rules.ts`.
 *
 * MSG-05: rewritten from a `.list-table` of filenames into a preview grid (image/video on top,
 * title underneath) now that a byte-serving route exists —
 * `GET /workspaces/{workspaceId}/media/{mediaId}/original` (authenticated, same-origin, Range
 * support for video seeking, `Content-Type` sniffed server-side from magic bytes). See
 * `api.mediaOriginalUrl`'s own comment for the URL contract.
 *
 * CONTENT TYPE (updated 2026-08-24): the media list response now DOES carry one — `AdminMedia
 * .contentType`, sniffed server-side from the stored bytes and persisted on `asset_blobs
 * .content_type`. That is what the "Images"/"Videos" tabs filter on (`rules.ts`'s
 * `filterMediaByTab`), replacing the "not wired up yet" placeholders those tabs used to render.
 *
 * `MediaPreview` below is deliberately UNCHANGED by that: it still resolves each card's preview
 * with its own optimistic probe rather than branching on `contentType`. The reasoning below still
 * holds — the probe already handles every case correctly (including the security defusal), costs
 * nothing extra for the common one, and a card that renders whatever the bytes really are cannot
 * be desynced from a stored field. The original description of the gap follows, since it is the
 * rationale for the probe's design:
 *
 * The hard problem this rewrite had to solve: **the media list response carried no content type**
 * (neither `media` nor `asset_blobs` stored one — upload validated `contentType` then discarded
 * it), so nothing in `AdminMedia` told the client whether a given asset was an image, a video, or
 * something unpreviewable. `MediaPreview` below resolves this client-side with an optimistic
 * render-and-fall-back chain (`<img>` → onError → `<video>` → onError → placeholder) rather than a
 * HEAD probe per card. Chosen over the HEAD approach because: (1) the byte route's documented
 * contract covers GET — sniffing/Range were specified for that, not for HEAD, so building on HEAD
 * would be assuming a behavior nobody confirmed; (2) a HEAD-first design means every card blocks on
 * a round trip before any pixel paints, working against the fixed-aspect-box + lazy-loading this
 * grid needs anyway, whereas the optimistic path costs nothing extra for the common case (a real
 * image just loads) and only "wastes" a request for the video/unsupported minority — and even then,
 * a browser's image decoder typically fails off the header bytes rather than pulling the whole
 * file; (3) it composes for free with the server's security defusal: a sniffed HTML/SVG comes back
 * as `application/octet-stream` with `Content-Disposition: attachment`, which is not a valid image
 * OR video MIME, so it fails both probes and lands on the placeholder with zero special-casing —
 * this file never needs to detect "is this the defused case" itself.
 *
 * SPEC-037 REQ-01: `EditMediaPanel` (renamed from `EditMediaRow` — no longer a table row now that
 * this screen is a card grid, not a table) is the `api.updateMedia` metadata-edit affordance:
 * title/alt/caption/credit, sending only the fields the user actually changed (partial-patch,
 * matching `updateMediaMetadata`'s own optional-field contract) rather than the whole draft object.
 *
 * MODAL (2026-09-07, owner ask): `EditMediaPanel` used to render inline as a full-width `.card`
 * above the grid, pushing every card down while open. It now renders inside `EditMediaModal`, a
 * single shared `<dialog>` (same "one instance, toggle its `item` prop" shape as `MediaLightbox`/
 * `ConfirmDialog` below — see `use-edit-media-modal.hooks.ts`'s own header) reachable from either
 * the row's existing `RowMenu` "Edit metadata" action OR a new eye-icon button on the card itself
 * (`MediaPreview`'s `onEdit`, mirroring its existing `onExpand` corner button). Both entry points
 * call the SAME `toggleEditing(item)` from `use-media.hooks.ts` — there is only ever one edit UI,
 * just two doors into it. `key={item.id}` still lives on `EditMediaPanel` itself (not the dialog),
 * preserving the 2026-08-12 audit fix documented at that `key`'s own call site below: the dialog box
 * stays mounted across an edit-target switch, but its form content still remounts and reseeds.
 *
 * Row actions moved into a `RowMenu` (one More menu per card, per MSG-05) instead of always-visible
 * buttons — Edit metadata, and Trash or Delete permanently depending on `status`. The
 * `window.confirm` that used to guard permanent delete is now `ConfirmDialog`, matching
 * `Posts.tsx`'s pattern: `pendingPurge` + `rowSavingId` state, dialog mounted unconditionally.
 * Trashing stays a single unconfirmed action (as before) — only the irreversible purge step gates
 * on the dialog, matching the original code's own trash-vs-purge asymmetry.
 *
 * Lightbox: `MediaLightbox` below opens a card's asset large. It is ONE shared `<dialog>` instance
 * for the whole grid — `lightboxIndex: number | null` state in `Media()` indexes into `media`,
 * exactly the same shape as `pendingPurge` already driving the single shared `ConfirmDialog` above
 * — not one `<dialog>` mounted per card. A grid can hold dozens of assets; mounting N real
 * `<dialog>` elements (each portaled into the browser's top layer by `showModal()`) to show at
 * most one open at a time buys nothing and costs N DOM subtrees. `useId()` is still used for the
 * shared instance's own heading id (not a hardcoded string) — not because a *second* concurrent
 * `MediaLightbox` exists today (it doesn't; one shared instance structurally cannot self-collide),
 * but because "no hardcoded dialog id" is this codebase's standing rule after the `ConfirmDialog`/
 * `Roles.tsx` incident (see that component's own doc comment), and a future caller mounting a
 * second `MediaLightbox` elsewhere should not have to rediscover that the hard way.
 */

export interface MediaProps {
  hooks: {
    /**
    * Dependency injection seam for tests — the same convention `Posts.tsx`'s `usePostsHook` uses.
    * Defaulted to the real hook, so production callers pass nothing and behave exactly as before.
    */
    useMediaHook: (required: { tab: MediaContentTabId; itemId?: string | null | undefined }) => MediaController;
    useMediaPreviewHook: (item: AdminMedia, t: (key: string) => string) => MediaPreviewController;
    useEditMediaPanelHook: (required: EditMediaPanelHookProps) => EditMediaPanelController;
    useEditMediaModalHook: typeof useEditMediaModal;
    useAdminKitValuesHook: () => Pick<AdminKitValues, "openLightboxDialog" | "closeLightboxDialog">;
    useMediaCardMetadataHook: typeof useMediaCardMetadata;
    useMediaCardDetailsHook: typeof useMediaCardDetails;
    useMediaGridSizeHook: typeof useMediaGridSize;
    useAdminThemeBoundaryHook: (required: object, optional?: { root?: HTMLElement }) => { "data-theme": "light" | "dark" };
    useMediaItemLinkHook: typeof useMediaItemLink;
    /**
    * Dependency injection seam for tests — same convention, no port (see `use-media-tabs.hooks.ts`'s
    * own doc for why this pure-UI-state hook has no `useWiredX()` pair to default to instead).
    */
    useMediaTabsHook: typeof useMediaTabs;
    /** The External Providers catalog read (same convention as `useMediaHook`). */
    useMediaProviderCatalogHook: (required: { port: MediaProviderCatalogPort }, optional?: Record<string, never>) => readonly MediaProviderOption[] | null;
    useFetchMutation: FetchQueryAdapter["useFetchMutation"];
    useRemoteImageImport: (required: {
      t: (key: string) => string; port: MediaProps["deps"]["defaultMediaImportPort"];
      describeError: MediaProps["deps"]["describeApiError"]; useFetchMutation: FetchQueryAdapter["useFetchMutation"];
    }, optional?: Record<string, never>) => {
      open: boolean; openDialog: (event: Pick<MouseEvent<HTMLButtonElement>, "currentTarget">) => void;
      close: () => void; url: string; setUrl: Dispatch<SetStateAction<string>>; alt: string;
      setAlt: Dispatch<SetStateAction<string>>; submit: (event?: Pick<FormEvent, "preventDefault">) => Promise<void>;
      pending: boolean; canSubmit: boolean; urlInvalid: boolean; error: string | null;
    };
  };
  kit: {
    Button: ComponentType<{ variant?: "primary" | "secondary"; type?: "button" | "submit"; className?: string;
      disabled?: boolean; onPress?: (required: Record<string, never>, optional?: Record<string, never>) => void;
      attrs?: Readonly<Record<string, string | boolean | undefined>>; children?: ReactNode }>;
    Dialog: ComponentType<{ open: boolean; title: string; pending?: boolean;
      onClose: (required: Record<string, never>, optional?: Record<string, never>) => void; className?: string; children?: ReactNode }>;
    TextField: ComponentType<{ label: string; value: string; type?: "url"; placeholder?: string; disabled?: boolean;
      onValueChange: (required: { value: string }, optional?: Record<string, never>) => void;
      attrs?: Readonly<Record<string, string | boolean | undefined>> }>;
    Icon: AdminKitComponents["Icon"];
    RowMenu: ComponentType<RowMenuProps>;
    ConfirmDialog: ComponentType<ConfirmDialogProps>;
    TabBar: AdminKitComponents["TabBar"];
    InfoTip: AdminKitComponents["InfoTip"];
    Lightbox: AdminKitComponents["Lightbox"];
    MiddleTruncate: ComponentType<{ text: string }>;
    ServerLabel: ComponentType<{ value: string }>;
    ChromePlaybackNote: ComponentType<{ item: Pick<AdminMedia, "videoCodec" | "byteSize">; t: (key: string) => string }>;
    EyeIcon: ComponentType; ExpandIcon: ComponentType; PlaceholderIcon: ComponentType; PlayIcon: ComponentType; UploadIcon: ComponentType;
    MediaLoadMore: ComponentType<{ hasMore: boolean; loading: boolean; error: string | null; onLoadMore: () => void; t: (key: string) => string }>;
    DockHeaderTip: ComponentType<{ label: string; children: ReactNode }>;
    PublishSectionButton: ComponentType<{ section: "media" }>;
    ExternalProvidersPanel: ComponentType<{ locale: string; catalog: readonly MediaProviderOption[] | null;
      useAdminThemeBoundaryHook: MediaProps["hooks"]["useAdminThemeBoundaryHook"] }>;
    RemoteImageImport: ComponentType<{
      t: (key: string) => string; port: MediaProps["deps"]["defaultMediaImportPort"];
      describeError: MediaProps["deps"]["describeApiError"]; useFetchMutation: FetchQueryAdapter["useFetchMutation"];
      HeaderTip: MediaProps["kit"]["DockHeaderTip"]; kit: Pick<MediaProps["kit"], "Button" | "Dialog" | "TextField">;
      useRemoteImageImportHook: MediaProps["hooks"]["useRemoteImageImport"];
    }>;
  };
  deps: {
    mediaFileName: typeof import("../../media/rules.js").mediaFileName;
    mediaProviderCatalogPort: MediaProviderCatalogPort;
    VIEWER_TIME_ZONE: string;
    MEDIA_GRID_SIZE_STORAGE_KEY: string;
    mediaTranslate: (required: { locale: string; key: string }) => string;
    VIDEO_CONVERSION_NOTICE_KEY: string;
    defaultMediaImportPort: { importFromUrl: (required: { url: string }, optional?: { alt?: string | undefined }) => Promise<{ readonly media: unknown }>; readonly listKey: QueryKey };
    describeApiError: (required: { e: unknown; fallback: string }) => string;
  };
  /** The zone an upload date is shown in: the viewer's own, never the site's schedule zone. Defaults to {@link VIEWER_TIME_ZONE}. */
  viewerTimeZone?: string;
  /** The `?tab=` query value from `panels.tsx`'s `media` route (`URLSearchParams.get` returns
   *  `null` when the param is absent). See `use-media-tabs.hooks.ts`'s `resolveActiveTab`. */
  tabId?: string | null;
  /** The `?id=` query value — the one media item whose detail (metadata) dialog the URL opens.
   *  See `use-media-item-link.hooks.ts`. */
  itemId?: string | null;
}

/** The grid tab a screen tab reads: the Providers tab has no grid, so it reads All. @complexity O(1). */
function gridTabFor({ activeTab }: { activeTab: MediaTabId }, _optional: Record<string, never> = {}): MediaContentTabId {
  return activeTab === "external-providers" ? "all" : activeTab;
}

/** One badge per tab: server counts for the grid tabs, the live catalog length for Providers. @complexity O(1). */
function mediaTabCounts(
  { counts, providerCatalog }: { counts: Partial<Record<MediaTabId, number>> | null; providerCatalog: readonly unknown[] | null },
  _optional: Record<string, never> = {},
): Partial<Record<MediaTabId, number>> {
  // The server's counts over every matching row, not the length of the loaded page.
  const catalogCount = providerCatalog ? { "external-providers": providerCatalog.length } : {};
  return { ...counts, ...catalogCount };
}

export function Media(props: MediaProps, _optional = {}) {
  const { deps, kit, hooks } = props;
  const { mediaProviderCatalogPort, VIEWER_TIME_ZONE } = deps;
  // No `MediaProps = {}` default on the parameter itself (same reasoning as `App.tsx`'s own
  // `AppProps` — see that file's comment): every real call site is JSX (`<Media />` in
  // `panels.tsx`/tests), and JSX's `createElement`/`jsx` runtime always constructs an actual props
  // object — `{}` when no attributes are given, never `undefined` — so `Media` is never invoked
  // with zero arguments the way a plain function call could be. `MediaProps`' three fields are all
  // optional, so `{}` satisfies the type and this compiles the same as before for every existing
  // call site.
  // Keep both injection seams. Forwarding resolvers previously isolated the default branches
  // for the complexity gate; Media is small enough to resolve them directly.
  const useMediaHook = props.hooks.useMediaHook;
  const useMediaTabsHook = props.hooks.useMediaTabsHook;
  // The site zone controls site schedules, not how an owner sees a local upload time.
  const viewerTimeZone = props.viewerTimeZone ?? VIEWER_TIME_ZONE;
  const { activeTab, setActiveTab } = useMediaTabsHook(props.tabId);
  const providerCatalog = props.hooks.useMediaProviderCatalogHook({ port: mediaProviderCatalogPort });
  // The Providers tab has no grid; it still reads page one of All for the server's tab counts.
  const controller = useMediaHook({ tab: gridTabFor({ activeTab }), itemId: props.itemId });
  const { media, error, t } = controller;
  const { notFound } = props.hooks.useMediaItemLinkHook({
    itemId: props.itemId,
    activeTab,
    media: controller.lookupMedia,
    editingId: controller.editingId,
    setEditingId: controller.setEditingId,
  });

  if (error && !media) return <div className="notice error">{error}</div>;
  if (!media) return <div className="notice">{t("Loading media…")}</div>;

  return <MediaLoaded props={props} controller={controller} media={media} activeTab={activeTab} setActiveTab={setActiveTab} providerCatalog={providerCatalog} notFound={notFound} viewerTimeZone={viewerTimeZone} />;
}

function MediaLoaded({ props, controller, media, activeTab, setActiveTab, providerCatalog, notFound, viewerTimeZone }: { props: MediaProps; controller: MediaController; media: AdminMedia[]; activeTab: MediaTabId; setActiveTab: MediaTabsController["setActiveTab"]; providerCatalog: ReturnType<MediaProps["hooks"]["useMediaProviderCatalogHook"]>; notFound: boolean; viewerTimeZone: string }, _optional = {}) {
  const { kit, deps, hooks } = props;
  const { ExternalProvidersPanel } = kit;
  const { t } = controller;
  // Per-tab item counts (owner ask, 2026-09-26) — computed once here, after the loading guard above
  // so `media` is non-null, and shared by BOTH of this function's returns below (External Providers
  // included), since the tab bar itself renders identically regardless of which tab is active.
  // "External Providers" counts the host's live provider catalog — the same array its panel maps one
  // card per entry from, so badge and cards agree; no badge while it loads or the host is unreachable.
  const tabCounts = mediaTabCounts({ counts: controller.counts, providerCatalog });

  // External Providers renders no grid, no filter, and has no concept of the grid's "empty" state —
  // an early return here (rather than a ternary further down) is what lets `MediaContentTabId`
  // narrow `activeTab` for the REST of this function, so `filterMediaByTab`/`MediaLibraryPanel`
  // below can declare that narrower type directly instead of re-widening to the full tab set (see
  // `MediaContentTabId`'s own doc comment in `use-media-tabs.hooks.ts`).
  if (activeTab === "external-providers") {
    return (
      <MediaPageShell kit={kit} t={t} activeTab={activeTab} setActiveTab={setActiveTab} tabCounts={tabCounts}>
        <ExternalProvidersPanel locale={controller.locale} catalog={providerCatalog} useAdminThemeBoundaryHook={props.hooks.useAdminThemeBoundaryHook} />
      </MediaPageShell>
    );
  }

  return <MediaGridContent props={props} controller={controller} media={media} activeTab={activeTab} setActiveTab={setActiveTab} tabCounts={tabCounts} notFound={notFound} viewerTimeZone={viewerTimeZone} />;
}

function MediaGridContent({ props, controller, media, activeTab, setActiveTab, tabCounts, notFound, viewerTimeZone }: { props: MediaProps; controller: MediaController; media: AdminMedia[]; activeTab: MediaContentTabId; setActiveTab: MediaTabsController["setActiveTab"]; tabCounts: Partial<Record<MediaTabId, number>>; notFound: boolean; viewerTimeZone: string }, _optional = {}) {
  const { deps, kit, hooks } = props;
  const { t } = controller;
  // Computed after every early return so `media` is non-null and `activeTab` is narrowed to
  // `MediaContentTabId`. Not memoized: a single filter over a media library is cheap next to the
  // render it feeds, and a `useMemo` here cannot be hoisted above the early returns without
  // changing hook order.
  // `media` is already this tab's rows in the chosen order: the server filters and sorts, because one
  // fetched page cannot be re-sorted or re-filtered into a globally ordered list.
  const visibleMedia = media;
  // Asset ids are stable and unique, so they disambiguate one card's expand button from another's —
  // same reasoning as every other list on this workstream.
  const mediaExpandHandles = buildAgentListHandles({ prefix: "media-item", ids: visibleMedia.map((item) => item.id) }
  );

  return (
    <MediaPageShell kit={kit} t={t} activeTab={activeTab} setActiveTab={setActiveTab} tabCounts={tabCounts}>
      {/* "all", "images" and "videos" all render the SAME grid, differing only in which items reach
          it — one code path, so a card looks and behaves identically whichever tab it is viewed
          from, and the lightbox/edit/row-menu wiring below cannot drift per tab. */}
      {notFound ? <div className="notice">{t("That media item wasn't found.")}</div> : null}
      <MediaLibraryPanel deps={deps} kit={kit} hooks={hooks}
        useMediaPreviewHook={props.hooks.useMediaPreviewHook}
        useEditMediaPanelHook={props.hooks.useEditMediaPanelHook}
        useEditMediaModalHook={props.hooks.useEditMediaModalHook}
        useAdminKitValuesHook={props.hooks.useAdminKitValuesHook}
        useMediaCardMetadataHook={props.hooks.useMediaCardMetadataHook}
        useMediaCardDetailsHook={props.hooks.useMediaCardDetailsHook}
        useMediaGridSizeHook={props.hooks.useMediaGridSizeHook}
        {...controller}
        viewerTimeZone={viewerTimeZone}
        activeTab={activeTab}
        visibleMedia={visibleMedia}
        mediaExpandHandles={mediaExpandHandles}
      />
    </MediaPageShell>
  );
}
