import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import type { MediaGridSize } from "./grid-size.js";
import type { MediaController } from "./hooks/use-media.hooks.js";
import type { useMediaGridSize } from "./hooks/use-media-grid-size.hooks.js";
import type { useMediaCardDetails } from "./hooks/use-media-card-details.hooks.js";
import type { useEditMediaModal } from "./hooks/use-edit-media-modal.hooks.js";
import type { useMediaCardMetadata } from "./hooks/use-media-card-metadata.hooks.js";
import type { MediaContentTabId } from "./hooks/use-media-tabs.hooks.js";
import type { MediaProps } from "./Media.js";
import { EditMediaModal } from "./MediaEditChildren.js";
import { MediaLightbox } from "./MediaLightbox.js";
import { MediaToolbar, MediaOrderControls } from "./MediaToolbar.js";
import { MediaPurgeDialog } from "./MediaPurgeDialog.js";
import { MediaGridOrEmpty, UploadConversionStatus, UntypedMediaNote } from "./MediaGridOrEmpty.js";

/**
 * Everything the "all"/"images"/"videos" tabs render — split out of `Media` for the same
 * "independent branches scored in their own scope" reasoning as `MediaToolbar`/`MediaPurgeDialog`/
 * `MediaGridOrEmpty` above: the error notice, edit-panel, and untyped-note ternaries were three
 * more of that component's own branches.
 *
 * Takes `Media`'s own controller spread rather than 20 individual props (`{...controller}` at the
 * call site below) — `media` is overridden with the already-null-checked value, since `Media` has
 * already handled the `!media` loading state by the time this renders.
 */
export function MediaLibraryPanel(
  props: Omit<MediaController, "media"> & { viewerTimeZone: string; activeTab: MediaContentTabId; visibleMedia: AdminMedia[]; mediaExpandHandles: string[]; useMediaPreviewHook: MediaProps["hooks"]["useMediaPreviewHook"]; useEditMediaPanelHook: MediaProps["hooks"]["useEditMediaPanelHook"]; useEditMediaModalHook: typeof useEditMediaModal; useAdminKitValuesHook: MediaProps["hooks"]["useAdminKitValuesHook"]; useMediaCardMetadataHook: typeof useMediaCardMetadata; useMediaCardDetailsHook: typeof useMediaCardDetails; useMediaGridSizeHook: typeof useMediaGridSize; } & Pick<MediaProps, "deps" | "kit" | "hooks">, _optional = {}) {
  const { deps } = props;
  const { MEDIA_GRID_SIZE_STORAGE_KEY } = deps;
  const [gridSize, setGridSize] = props.useMediaGridSizeHook({ storageKey: MEDIA_GRID_SIZE_STORAGE_KEY });

  return <MediaLibraryBody {...props} gridSize={gridSize} setGridSize={setGridSize} />;
}

function MediaLibraryBody(props: Omit<MediaController, "media"> & { viewerTimeZone: string; activeTab: MediaContentTabId; visibleMedia: AdminMedia[]; mediaExpandHandles: string[]; useMediaPreviewHook: MediaProps["hooks"]["useMediaPreviewHook"]; useEditMediaPanelHook: MediaProps["hooks"]["useEditMediaPanelHook"]; useEditMediaModalHook: typeof useEditMediaModal; useAdminKitValuesHook: MediaProps["hooks"]["useAdminKitValuesHook"]; useMediaCardMetadataHook: typeof useMediaCardMetadata; useMediaCardDetailsHook: typeof useMediaCardDetails; useMediaGridSizeHook: typeof useMediaGridSize; } & { gridSize: MediaGridSize; setGridSize: (value: MediaGridSize) => void } & Pick<MediaProps, "kit" | "deps" | "hooks">, _optional = {}) {
  const { kit, deps, hooks } = props;
  const { MediaLoadMore } = kit;
  const { error, activeTab, visibleMedia, mediaExpandHandles, conversionNotice, editingId, editingItem, toggleEditing, onMetadataSaved, setEditingId, trash, restore, pendingPurge, setPendingPurge, rowSavingId, purge, lightboxIndex, setLightboxIndex, orderBy, setOrderBy, hasUntypedActive, hasMore, loadingMore, loadMoreError, loadMore, t, locale, viewerTimeZone, } = props;
  const { gridSize, setGridSize } = props;
  return (
    <>
      {error ? <div className="notice error">{error}</div> : null}
      {/* On the page, not in the upload dialog: the dialog closes on success, and the notice reports that success. */}
      <UploadConversionStatus deps={deps} notice={conversionNotice} t={t} />
      {/* One row: "Order by" on the left, the two entry points (owner item #9, 2026-10-13) pushed to
          the right edge. Each button owns its dialog. */}
      <MediaLibraryToolbar kit={kit} deps={deps} hooks={hooks} orderBy={orderBy} setOrderBy={setOrderBy} gridSize={gridSize} setGridSize={setGridSize} t={t} props={props} />

      <MediaLibraryEdit props={props} editingItem={editingItem} onMetadataSaved={onMetadataSaved} setEditingId={setEditingId} t={t} />

      {(activeTab === "images" || activeTab === "videos") && hasUntypedActive ? <UntypedMediaNote t={t} /> : null}

      <MediaLibraryGrid kit={kit} deps={deps} props={props} activeTab={activeTab} visibleMedia={visibleMedia} mediaExpandHandles={mediaExpandHandles} gridSize={gridSize} editingId={editingId} locale={locale} viewerTimeZone={viewerTimeZone} t={t} setLightboxIndex={setLightboxIndex} toggleEditing={toggleEditing} trash={trash} restore={restore} rowSavingId={rowSavingId} setPendingPurge={setPendingPurge} />
      <MediaLoadMore hasMore={hasMore} loading={loadingMore} error={loadMoreError} onLoadMore={() => void loadMore()} t={t} />

      <MediaLibraryOverlays kit={kit} props={props} visibleMedia={visibleMedia} lightboxIndex={lightboxIndex} setLightboxIndex={setLightboxIndex} t={t} pendingPurge={pendingPurge} rowSavingId={rowSavingId} purge={purge} setPendingPurge={setPendingPurge} />
    </>
  );
}

function MediaLibraryToolbar({ orderBy, setOrderBy, gridSize, setGridSize, t, props, kit, deps, hooks }: { orderBy: MediaController["orderBy"]; setOrderBy: MediaController["setOrderBy"]; gridSize: MediaGridSize; setGridSize: (value: MediaGridSize) => void; t: MediaController["t"]; props: Parameters<typeof MediaLibraryBody>[0] } & Pick<MediaProps, "kit" | "deps" | "hooks">, _optional = {}) {
  const { Button, Dialog, TextField, DockHeaderTip, RemoteImageImport } = kit;
  const { defaultMediaImportPort, describeApiError } = deps;
  const { useRemoteImageImport, useFetchMutation } = hooks;
  /** The kit components the cms import dialog renders with; `satisfies` fails here if a kit prop drifts. */
  const IMPORT_DIALOG_KIT = { Button, Dialog, TextField } satisfies Pick<MediaProps["kit"], "Button" | "Dialog" | "TextField">;
  return (
<div className="toolbar media-order-row">
        <MediaOrderControls orderBy={orderBy} setOrderBy={setOrderBy} size={gridSize} setSize={setGridSize} t={t} />
        <div className="media-actions">
          <MediaToolbar {...props} />
          <RemoteImageImport useRemoteImageImportHook={useRemoteImageImport} t={t} kit={IMPORT_DIALOG_KIT} HeaderTip={DockHeaderTip} port={defaultMediaImportPort}
            describeError={describeApiError} useFetchMutation={useFetchMutation} />
        </div>
      </div>
  );
}

/** `key` on `EditMediaPanel` INSIDE `EditMediaModal` (2026-08-12 audit round 2, blocker F1 —
          domain 4, writing to the wrong record; the modal wrapper added 2026-09-07 does not change
          this). Without it this panel is a single reused instance: `toggleEditing` goes from item
          A's id straight to item B's id (`setEditingId((id) => id === item.id ? null : item.id)` —
          it only passes through `null` when you re-click the SAME row, and `mediaRowMenuItems`
          leaves every other row's "Edit metadata" enabled while one is open), so React re-renders
          rather than remounting. `useEditMediaPanel` seeds `draft` in a `useState` initializer,
          which runs once per mount and never re-reads `item` — so `draft` stayed bound to A while
          `item` became B, and `save()` PATCHed B's id with A's title/alt/caption/credit/dimensions.
          Two ordinary clicks, no race, no adversarial input, and zero test coverage.
          This surface was wrongly recorded as already covered by the `panels.tsx` `key=` sweep —
          it is not router-driven, so that sweep never reached it. See `EditMediaModal`'s own doc
          comment for why the `key` lives on `EditMediaPanel`, not on the `<dialog>` around it. */
function MediaLibraryEdit({ props, editingItem, onMetadataSaved, setEditingId, t }: { props: Parameters<typeof MediaLibraryBody>[0]; editingItem: MediaController["editingItem"]; onMetadataSaved: MediaController["onMetadataSaved"]; setEditingId: MediaController["setEditingId"]; t: MediaController["t"] }, _optional = {}) {
  return (
<EditMediaModal useEditMediaPanelHook={props.useEditMediaPanelHook} useEditMediaModalHook={props.useEditMediaModalHook} useAdminKitValuesHook={props.useAdminKitValuesHook} item={editingItem} onSaved={onMetadataSaved} onCancel={() => setEditingId(null)} t={t} />
  );
}

function MediaLibraryGrid({ props, activeTab, visibleMedia, mediaExpandHandles, gridSize, editingId, locale, viewerTimeZone, t, setLightboxIndex, toggleEditing, trash, restore, rowSavingId, setPendingPurge, kit, deps }: { props: Parameters<typeof MediaLibraryBody>[0]; activeTab: MediaContentTabId; visibleMedia: AdminMedia[]; mediaExpandHandles: string[]; gridSize: MediaGridSize; editingId: MediaController["editingId"]; locale: MediaController["locale"]; viewerTimeZone: string; t: MediaController["t"]; setLightboxIndex: MediaController["setLightboxIndex"]; toggleEditing: MediaController["toggleEditing"]; trash: MediaController["trash"]; restore: MediaController["restore"]; rowSavingId: MediaController["rowSavingId"]; setPendingPurge: MediaController["setPendingPurge"] } & Pick<MediaProps, "kit" | "deps">, _optional = {}) {
  return (
<MediaGridOrEmpty kit={kit} deps={deps}
        useMediaCardDetailsHook={props.useMediaCardDetailsHook}
        useMediaPreviewHook={props.useMediaPreviewHook}
        useMediaCardMetadataHook={props.useMediaCardMetadataHook}
        activeTab={activeTab}
        visibleMedia={visibleMedia}
        mediaExpandHandles={mediaExpandHandles}
        gridSize={gridSize}
        editingId={editingId}
        locale={locale}
        viewerTimeZone={viewerTimeZone}
        t={t}
        onExpand={setLightboxIndex}
        onToggleEdit={toggleEditing}
        onTrash={trash}
        onRestore={restore}
        rowSavingId={rowSavingId}
        onRequestPurge={setPendingPurge}
      />
  );
}

function MediaLibraryOverlays({ props, visibleMedia, lightboxIndex, setLightboxIndex, t, pendingPurge, rowSavingId, purge, setPendingPurge, kit }: { props: Parameters<typeof MediaLibraryBody>[0]; visibleMedia: AdminMedia[]; lightboxIndex: MediaController["lightboxIndex"]; setLightboxIndex: MediaController["setLightboxIndex"]; t: MediaController["t"]; pendingPurge: MediaController["pendingPurge"]; rowSavingId: MediaController["rowSavingId"]; purge: MediaController["purge"]; setPendingPurge: MediaController["setPendingPurge"] } & Pick<MediaProps, "kit">, _optional = {}) {
return <>
      {/* `items` MUST be the same array the grid above maps, not the unfiltered `media`:
          `lightboxIndex` is a positional index produced by that map, so handing the lightbox a
          different array would open the wrong asset (and mis-clamp its prev/next arrows) on
          every filtered tab. */}
      <MediaLightbox kit={kit}
        useMediaPreviewHook={props.useMediaPreviewHook}
        items={visibleMedia}
        activeIndex={lightboxIndex}
        onNavigate={setLightboxIndex}
        onClose={() => setLightboxIndex(null)}
        t={t}
      />

      <MediaPurgeDialog kit={kit}
        pendingPurge={pendingPurge}
        rowSavingId={rowSavingId}
        onConfirm={purge}
        onCancel={() => setPendingPurge(null)}
        t={t}
      />
</>;
}
