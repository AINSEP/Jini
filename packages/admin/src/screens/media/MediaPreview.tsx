import type { ReactNode } from "react";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { mediaFillsPreview, mediaShapeBadges } from "./rules.js";
import type { MediaShape } from "./rules.js";
import type { MediaPreviewController } from "./hooks/use-media-preview.hooks.js";
import type { MediaProps } from "./Media.js";

interface MediaPreviewProps {
  item: AdminMedia;
  onExpand?: () => void;
  /** This card's own expand-button handle, or `undefined` when this instance has no expand button
   *  at all (the lightbox's own reuse of this component omits it, same as it omits `onExpand`).
   *  Passed down rather than derived here so the uniqueness search runs once, over the whole grid,
   *  in `Media()` — see `Taxonomy.tsx`'s `NewTermForm.agentBase` for why a per-instance search
   *  cannot dedupe across siblings. */
  agentExpandHandle?: string | undefined;
  /** The eye-icon edit trigger, as one optional unit so a trigger can never render without its handle.
   *  `undefined` for the same reason `onExpand` is: the lightbox's own reuse of this component
   *  omits it, since editing metadata from inside the enlarged view isn't part of this ask. */
  edit?: {
    /** Opens `EditMediaModal` for this card's item — the eye-icon trigger (owner ask, 2026-09-07). */
    onEdit: () => void;
    /** This card's own eye-button handle — same "passed down, not derived here" reasoning as
     *  `agentExpandHandle`. Required with `onEdit` (they were two independent optionals before,
     *  which left an "edit button without a handle" branch no caller could reach). */
    agentHandle: string;
  };
  /**
   * Dependency injection seam for tests — the same convention `Posts.tsx`'s `usePostsHook` uses.
   * Defaulted to the real (wired) hook, so production callers pass nothing and behave exactly as
   * before. Typed against `useWiredMediaPreview` (the zero-dependencies pair), not the raw
   * `useMediaPreview(item, deps)` — this component has no reason to see `deps` itself, matching
   * `PostsProps.usePostsHook`'s own shape.
   */
  useMediaPreviewHook: MediaProps["hooks"]["useMediaPreviewHook"];
  /** Translator closure — see `Media()`'s own `t` for where this comes from; threaded through the
   *  lightbox too, since it remounts this same component for its enlarged view. */
  t: (key: string) => string;
}

/** (2026-09-30, owner ask) For the `"image"` stage the expand button now fills the whole preview
 * (`media-card-expand-fill`, wrapping the `<img>`) so clicking the picture opens
 * the lightbox; the corner glyph stays inside it as the visual cue.
 *
 * (2026-10-29 owner design) A grid card's `"video"` stage is now a still frame (`<video>` with no
 * `controls`) inside the same whole-preview button, with a play cue; it plays in the lightbox at its
 * real shape. The paragraph below about `<video controls>` now applies only to the lightbox, which
 * passes no `onExpand` and so never wraps its player in a button.
 *
 * Resolves whether an asset previews as an image, a video, or neither — see this file's header
 * comment for why this is a client-side fallback chain rather than a server content-type read.
 *
 * `onExpand`, when passed, opens the lightbox: a whole-picture button for images, a small corner icon button for video
 * (used by the grid card to open `MediaLightbox`; omitted when `MediaLightbox` itself reuses this
 * same component to render its own enlarged content, so the lightbox never grows a nested trigger
 * for itself). Deliberately NOT a click handler on the whole preview box: the `"video"` stage below
 * renders a live `<video controls>`, and (a) interactive content cannot legally nest inside a
 * `<button>`, so a whole-preview `<button>` wrapper is not an option for that stage, and (b) even
 * without the nesting rule, a whole-box click target would swallow clicks aimed at the video's own
 * play/seek bar. A small corner icon works identically for both the `"image"` and `"video"` stages,
 * so the interaction model doesn't change per asset type. Omitted entirely for `"unsupported"` —
 * that stage already renders a "Download original" link, and the lightbox would show nothing more
 * than the exact same placeholder, just bigger. */
export function MediaPreview(props: MediaPreviewProps & Pick<MediaProps, "kit">, _optional = {}) {
  const { kit } = props;
  const { EyeIcon } = kit;
  const { useMediaPreviewHook, t } = props;
  const preview = useMediaPreviewHook(props.item, t);
  const { stage, src, altText, handleImageError, handleVideoError } = preview;

  // Computed ahead of the stage branches (unlike `expandButton` below, which the `"unsupported"`
  // branch never needed) — editing an asset's metadata is meaningful regardless of whether its
  // bytes can be previewed, so this renders in all three stages, not just image/video.
  const editButton = props.edit ? (
    <button
      type="button"
      className="media-card-edit"
      aria-label={t('Edit "{title}"').replace("{title}", () => props.item.title)}
      onClick={props.edit.onEdit}
      {...agentHandle({ handle: props.edit.agentHandle }, { role: "button", label: "Open the edit form for this asset as a modal" })}
    >
      <EyeIcon />
    </button>
  ) : null;

  if (stage === "unsupported") {
    return (
      <MediaUnsupportedPreview kit={kit} t={t} src={src} editButton={editButton} />
    );
  }

  // The lightbox's own reuse (no `onExpand`) is where a video plays, at its real shape, with
  // native controls. A grid card (owner design, 2026-10-29) shows a fitted still frame with a play
  // cue instead: the card-sized player cropped vertical videos to their middle third and crowded
  // its controls under the corner buttons.
  if (!props.onExpand) {
    return (
      <MediaInlinePreview stage={stage} src={src} altText={altText} handleVideoError={handleVideoError} handleImageError={handleImageError} editButton={editButton} />
    );
  }

  return (
    <MediaCardStage kit={kit}
      preview={preview}
      title={props.item.title}
      onExpand={props.onExpand}
      agentExpandHandle={props.agentExpandHandle}
      editButton={editButton}
      t={t}
    />
  );
}

    // Not a bare icon: a non-previewable asset (most often the server's own defused HTML/SVG
    // response — `application/octet-stream` + `Content-Disposition: attachment`, deliberately
    // non-rendering) is not a *broken* asset. The byte route worked; there's just nothing to draw
    // inline. So this still gives the operator a way to get the file, via the same `/original`
    // URL a working preview would have used as its `src` — the attachment header makes that link a
    // real download/open action, not a failed attempt to render it again.
function MediaUnsupportedPreview({ t, src, editButton, kit }: { t: (key: string) => string; src: string; editButton: ReactNode } & Pick<MediaProps, "kit">, _optional = {}) {
  const { PlaceholderIcon } = kit;
  return (
<div className="media-card-placeholder">
        <PlaceholderIcon />
        <p className="media-card-placeholder-text">{t("Preview not available")}</p>
        <a className="media-card-placeholder-link" href={src} target="_blank" rel="noreferrer">
          {t("Download original")}
        </a>
        {editButton}
      </div>
  );
}

function MediaInlinePreview({ stage, src, altText, handleVideoError, handleImageError, editButton }: { stage: MediaPreviewController["stage"]; src: string; altText: string; handleVideoError: MediaPreviewController["handleVideoError"]; handleImageError: MediaPreviewController["handleImageError"]; editButton: ReactNode }, _optional = {}) {
  return (
<>
        {stage === "video" ? (
          <video className="media-card-media" src={src} controls preload="metadata" aria-label={altText} onError={handleVideoError} />
        ) : (
          <img className="media-card-media" src={src} alt={altText} loading="lazy" onError={handleImageError} />
        )}
        {editButton}
      </>
  );
}

/** A grid card's preview stage: the fitted asset inside the whole-preview open-larger button, its
 *  kind cue (play or expand) and its shape badges. Split from `MediaPreview` for complexity. */
function MediaCardStage({ preview, title, onExpand, agentExpandHandle, editButton, t, kit }: {
  preview: ReturnType<MediaProps["hooks"]["useMediaPreviewHook"]>;
  title: string;
  onExpand: () => void;
  agentExpandHandle?: string | undefined;
  editButton: ReactNode;
  t: (key: string) => string;
} & Pick<MediaProps, "kit">, _optional = {}) {
  const { ExpandIcon, PlayIcon } = kit;
  const { stage } = preview;
  const expandHandle = agentExpandHandle
    ? agentHandle({ handle: agentExpandHandle }, { role: "button", label: "Open this asset larger in the lightbox" })
    : {};

  // The picture itself sits INSIDE the expand button (an `<img>` is legal button content), so a
  // click anywhere on it opens the lightbox and Enter/Space work on the button.
  return (
    <>
      <button
        type="button"
        className="media-card-expand media-card-expand-fill"
        aria-label={t('View "{title}" larger').replace("{title}", () => title)}
        onClick={onExpand}
        {...expandHandle}
      >
        <MediaCardPicture preview={preview} />
        {stage === "video" ? <PlayIcon /> : <ExpandIcon />}
      </button>
      {editButton}
    </>
  );
}

/** The preview image/video and decorative backdrop share one fitted asset snapshot. */
function MediaCardPicture({ preview }: { preview: ReturnType<MediaProps["hooks"]["useMediaPreviewHook"]> }, _optional = {}) {
  const { stage, src, altText, handleImageError, handleVideoError, shape, handleImageLoad, handleVideoMetadata } = preview;
  const badges = shape ? mediaShapeBadges(shape) : null;
  // A `<video>` without `controls` is not interactive content, so (like an `<img>`) it may sit
  // inside the expand button: clicking the still frame opens the lightbox for both kinds.
  const fill = shape ? mediaFillsPreview(shape) : false;
  const fit = fill ? " media-card-media--fill" : "";
  const media = stage === "video" ? (
    <video className={`media-card-media${fit}`} src={src} preload="metadata" muted playsInline aria-label={altText} onError={handleVideoError} onLoadedMetadata={handleVideoMetadata} />
  ) : (
    <img className={badges?.isLong ? "media-card-media media-card-media--long" : `media-card-media${fit}`} src={src} alt={altText} loading="lazy" onError={handleImageError} onLoad={handleImageLoad} />
  );
  // A tall or very wide image stays whole (never cropped), so its spare space gets a soft blurred
  // copy of the same picture instead of flat gray. Videos keep the card background: a second
  // decoding <video> per tile is not worth a blur.
  const backdrop = showMediaBackdrop({ stage, shape, fill, badges }) ? (
    <img className="media-card-backdrop" src={src} alt="" aria-hidden="true" loading="lazy" />
  ) : null;

  return <>{backdrop}{media}</>;
}

/** Only still images with spare space need a decorative blurred copy; never decode a second video. */
function showMediaBackdrop({ stage, shape, fill, badges }: {
  stage: ReturnType<MediaProps["hooks"]["useMediaPreviewHook"]>["stage"]; shape: MediaShape | null;
  fill: boolean; badges: ReturnType<typeof mediaShapeBadges> | null;
}, _optional = {}): boolean {
  return stage === "image" && !!shape && !fill && !badges?.isLong;
}
