import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import type { MediaGridSize } from "./grid-size.js";
import type { useMediaCardDetails } from "./hooks/use-media-card-details.hooks.js";
import type { useMediaCardMetadata } from "./hooks/use-media-card-metadata.hooks.js";
import type { MediaContentTabId } from "./hooks/use-media-tabs.hooks.js";
import type { MediaProps } from "./Media.js";
import type { MediaController } from "./hooks/use-media.hooks.js";
import { MediaCard } from "./MediaCards.js";

/**
 * The grid-or-empty-state half of the "all"/"images"/"videos" tabs — split out of `Media` for the
 * same reason `MediaToolbar`/`MediaPurgeDialog` above already are: `visibleMedia.length === 0`'s
 * nested tab-kind ternary was one of that component's own independent branches (and, per
 * `sonarjs/no-nested-conditional`, a nested ternary in its own right); scored here in its own scope
 * instead.
 */
export function MediaGridOrEmpty({ useMediaCardDetailsHook, useMediaPreviewHook, useMediaCardMetadataHook, activeTab, visibleMedia, mediaExpandHandles, gridSize, editingId, locale, viewerTimeZone, t, onExpand, onToggleEdit, onTrash, onRestore, rowSavingId, onRequestPurge, kit, deps }: { useMediaCardDetailsHook: typeof useMediaCardDetails; useMediaPreviewHook: MediaProps["hooks"]["useMediaPreviewHook"]; useMediaCardMetadataHook: typeof useMediaCardMetadata; gridSize: MediaGridSize; activeTab: MediaContentTabId; visibleMedia: AdminMedia[]; mediaExpandHandles: string[]; editingId: string | null; locale: string; viewerTimeZone: string; t: (key: string) => string; onExpand: (index: number) => void; onToggleEdit: (item: AdminMedia) => void; onTrash: (item: AdminMedia) => void; onRestore: (item: AdminMedia) => void; rowSavingId: string | null; onRequestPurge: (item: AdminMedia | null) => void; } & Pick<MediaProps, "kit" | "deps">, _optional = {}) {
  const { isPhone, openDetails } = useMediaCardDetailsHook({ onToggleEdit });
  if (visibleMedia.length === 0) {
    if (activeTab === "all") {
      return (
        <div className="card">
          <div className="empty-state">
            <p>{t("No media uploaded yet.")}</p>
            <p className="page-description">{t("Use Upload image above to add your first file.")}</p>
          </div>
        </div>
      );
    }
    if (activeTab === "trash") return <MediaTrashEmptyState t={t} />;
    return <MediaTypeEmptyState kind={activeTab} t={t} />;
  }

  return (
    <div className="media-grid" data-size={gridSize}>
      {visibleMedia.map((item, index) => (
        <MediaCard kit={kit} deps={deps}
          useMediaPreviewHook={useMediaPreviewHook}
          useMediaCardMetadataHook={useMediaCardMetadataHook}
          key={item.id}
          item={item}
          showTrashCountdown={activeTab === "trash"}
          handle={mediaExpandHandles[index]}
          onExpand={() => onExpand(index)}
          menu={{ editingId, locale, viewerTimeZone, rowSavingId, isPhone, onOpenDetails: openDetails, onToggleEdit, onTrash, onRestore, onRequestPurge }}
          t={t}
        />
      ))}
    </div>
  );
}

/**
 * The empty state for a tab whose filter matched nothing — distinct from the All tab's "No media
 * uploaded yet.", which would be a lie on a filtered tab holding a library full of other types.
 *
 * NOTE (2026-09-07, fixed): this comment used to explain why the Videos tab was normally empty —
 * first "the server allowlist rejects video" (false since 2026-08-24), then, after that was
 * corrected, "this screen's own file-input `accept` filter lists only the image types" (Agent H's
 * finding, `MediaToolbar`'s `accept` above — that gap was real and is now fixed too). With both the
 * server ceiling AND this screen's own file picker accepting `video/mp4`/`video/webm`, a video is a
 * completely ordinary upload now — the Videos tab's copy below matches the Images tab's own
 * "appears here once you add them" phrasing instead of claiming videos aren't supported.
 */
function MediaTypeEmptyState({ kind, t }: { kind: "images" | "videos"; t: (key: string) => string }, _optional = {}) {
  return (
    <div className="card">
      <div className="empty-state">
        <p>{kind === "images" ? t("No images yet.") : t("No videos yet.")}</p>
        <p className="page-description">
          {kind === "images"
            ? t("Uploaded images appear here once you add them.")
            : t("Uploaded videos appear here once you add them.")}
        </p>
      </div>
    </div>
  );
}

/** The Trash tab's empty state (owner, 2026-10-23) — same card as the type tabs' own. */
function MediaTrashEmptyState({ t }: { t: (key: string) => string }, _optional = {}) {
  return (
    <div className="card">
      <div className="empty-state">
        <p>{t("Trash is empty.")}</p>
        <p className="page-description">{t("Media you trash appears here.")}</p>
      </div>
    </div>
  );
}

/** Non-error status for an upload that was stored as-is because its web-playable copy could not be made.
 *  The server sends only the fixed code; the sentence is localized here. */
export function UploadConversionStatus({ notice, t, deps }: { notice: MediaController["conversionNotice"]; t: (key: string) => string } & Pick<MediaProps, "deps">, _optional = {}) {
  const { VIDEO_CONVERSION_NOTICE_KEY } = deps;
  if (notice !== "web-copy-unavailable") return null;
  return <div role="status" className="notice">{t(VIDEO_CONVERSION_NOTICE_KEY)}</div>;
}

/** Note shown on a filtered tab when some assets have no detected type. See `rules.ts`'s
 *  `hasUntypedMedia` for why this is normally absent, and why silence would be the wrong default. */
export function UntypedMediaNote({ t }: { t: (key: string) => string }, _optional = {}) {
  return (
    <div className="notice">
      {t("Some items have no detected type and aren't shown in this tab.")}{" "}
      {t("You can find them on the All tab.")}
    </div>
  );
}
