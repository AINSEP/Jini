import type { ReactNode } from "react";
import type { AdminMedia, MediaGridPage } from "@jini-ai/core/contracts/site/cms-admin-media";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { mediaRowMenuItems, mediaShapeBadges } from "./rules.js";
import type { MediaShape } from "./rules.js";
import type { useMediaCardMetadata } from "./hooks/use-media-card-metadata.hooks.js";
import type { MediaProps } from "./Media.js";
import { MediaPreview } from "./MediaPreview.js";

interface MediaCardMenuProps {
  editingId: string | null;
  locale: string;
  viewerTimeZone: string;
  rowSavingId: string | null;
  isPhone: boolean;
  onOpenDetails: (item: AdminMedia) => void;
  onToggleEdit: (item: AdminMedia) => void;
  onTrash: (item: AdminMedia) => void;
  onRestore: (item: AdminMedia) => void;
  onRequestPurge: (item: AdminMedia | null) => void;
}

/** Row 2 of a card's info section: one muted line "1440×900 · 0:38 · 4.4 MB · Oct 31, 2026"
 *  (owner design, 2026-11-01 — the shape and length used to be badges on the picture). Parts that
 *  do not apply are left out, so an image has no length and an unloaded one no size yet. Each part
 *  stays its own element so a part can be found by its text. */
function MediaCardMetadata(props: { useMediaCardMetadataHook: typeof useMediaCardMetadata; item: AdminMedia; locale: string; viewerTimeZone: string; shape: MediaShape | null; t: (key: string) => string }, _optional = {}) {
  const metadata = props.useMediaCardMetadataHook({ item: props.item }, { locale: props.locale, viewerTimeZone: props.viewerTimeZone });
  const parts = mediaShapeParts({ shape: props.shape, t: props.t });
  if (metadata.byteSize) parts.push(<span key="bytes">{metadata.byteSize}</span>);
  // The date sits alone on the right edge of the row (owner design, 2026-11-01), under the menu.
  const date = metadata.uploadDate ? <time dateTime={metadata.uploadDateTime}>{metadata.uploadDate}</time> : null;
  if (parts.length === 0 && !date) return null;
  return (
    <p className="media-card-size">
      <span className="media-card-specs">{parts.flatMap((part, index) => (index === 0 ? [part] : [" · ", part]))}</span>
      {date}
    </p>
  );
}

/**
 * One grid card. It owns the preview controller (and passes it down to `MediaPreview`) because the
 * loaded shape feeds two places: how the picture fits, and the "1440×900 · 0:38" part of the card's
 * second info row (owner design, 2026-11-01 — they were badges on the picture).
 */
export function MediaCard({ item, showTrashCountdown, handle, onExpand, menu, t, useMediaPreviewHook, useMediaCardMetadataHook, kit, deps }: {
  useMediaPreviewHook: MediaProps["hooks"]["useMediaPreviewHook"]; useMediaCardMetadataHook: typeof useMediaCardMetadata;
  item: MediaGridPage["media"][number]; showTrashCountdown: boolean; handle: string | undefined; onExpand: () => void; menu: MediaCardMenuProps; t: (key: string) => string;
} & Pick<MediaProps, "kit" | "deps">, _optional = {}) {
  const { RowMenu, ServerLabel, ChromePlaybackNote } = kit;
  const { mediaTranslate } = deps;
  const preview = useMediaPreviewHook(item, t);
  return (
    <div className="media-card">
      <div className="media-card-preview">
        <MediaPreview kit={kit}
          item={item}
          onExpand={onExpand}
          agentExpandHandle={`${handle}-expand`}
          edit={{ onEdit: () => menu.onToggleEdit(item), agentHandle: `${handle}-edit` }}
          useMediaPreviewHook={() => preview}
          t={t}
        />
      </div>
      <div className="media-card-body">
        <div className="media-card-meta">
          <MediaCardTitle kit={kit} mediaFileName={deps.mediaFileName} item={item} isPhone={menu.isPhone} onOpenDetails={menu.onOpenDetails} t={t} />
          <span className={`status status-${item.status}`}><ServerLabel value={item.status} /></span>
          {/* Restore stays one visible click on the Trash tab; the irreversible delete stays in the menu. */}
          {item.status === "trashed" ? (
            <button
              type="button"
              className="btn-secondary media-card-restore"
              disabled={menu.rowSavingId === item.id}
              aria-label={`${t("Restore")}: ${item.title}`}
              onClick={() => menu.onRestore(item)}
              {...agentHandle({ handle: `${handle}-restore` }, { role: "button", label: "Restore this trashed asset to the library" })}
            >{t("Restore")}</button>
          ) : null}
          <RowMenu
            triggerLabel={t('Actions for "{title}"').replace("{title}", () => item.title)}
            agentHandle={`${handle}-menu`}
            items={mediaRowMenuItems({ item, editingId: menu.editingId, handlers: { onToggleEdit: menu.onToggleEdit, onTrash: menu.onTrash, onRequestPurge: menu.onRequestPurge }, locale: menu.locale, translate: mediaTranslate })}
          />
        </div>
        <MediaCardMetadata useMediaCardMetadataHook={useMediaCardMetadataHook} item={item} locale={menu.locale} viewerTimeZone={menu.viewerTimeZone} shape={preview.shape} t={t} />
        {showTrashCountdown && item.status === "trashed" && item.trashDaysRemaining !== undefined ? <p className="page-description">{t("{days} days left").replace("{days}", String(item.trashDaysRemaining))}</p> : null}
        <ChromePlaybackNote item={item} t={t} />
      </div>
    </div>
  );
}

/**
 * The card's file name with its extension (owner, 2026-10-21), cut in the middle so the extension
 * stays visible. Desktop hover/focus shows the full name in the shared InfoTip bubble; on a phone the
 * name is the details button, whose label carries the full name.
 */
function MediaCardTitle({ item, isPhone, onOpenDetails, t, kit, mediaFileName }: {
  item: AdminMedia; isPhone: boolean; onOpenDetails: (item: AdminMedia) => void; t: (key: string) => string;
  mediaFileName: MediaProps["deps"]["mediaFileName"];
} & Pick<MediaProps, "kit">, _optional = {}) {
  const { InfoTip, MiddleTruncate } = kit;
  const fileName = mediaFileName({ title: item.title, contentType: item.contentType });
  return (
    <p className="media-card-title">
      {isPhone ? <button
        type="button"
        className="media-card-details"
        aria-label={`${t("Edit metadata")}: ${fileName}`}
        onClick={() => onOpenDetails(item)}
      ><MiddleTruncate text={fileName} /></button> : <InfoTip label={fileName} icon={<MiddleTruncate text={fileName} />} />}
    </p>
  );
}

/** Shape-derived labels omit unknown dimensions and inapplicable duration without hiding other metadata. */
function mediaShapeParts({ shape, t }: { shape: MediaShape | null; t: (key: string) => string }, _optional = {}): ReactNode[] {
  const badges = shape ? mediaShapeBadges(shape) : null;
  const parts: ReactNode[] = [];
  if (badges?.isLong) parts.push(<span key="long">{t("Long image")}</span>);
  if (badges) parts.push(<span key="size">{badges.size}</span>);
  if (badges?.duration) parts.push(<span key="duration">{badges.duration}</span>);

  return parts;
}
