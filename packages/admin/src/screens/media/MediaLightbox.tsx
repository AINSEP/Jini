import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { resolveLightboxItem } from "./rules.js";
import type { MediaProps } from "./Media.js";
import { MediaPreview } from "./MediaPreview.js";

interface MediaLightboxProps {
  useMediaPreviewHook: MediaProps["hooks"]["useMediaPreviewHook"];
  /** The full grid list, not just the open item, so the lightbox can count the set and clamp
   *  prev/next from the same data its caller already has in scope. */
  items: AdminMedia[];
  /** Index into `items` that is open, or `null` when closed. An index rather than the item itself
   *  so navigating just moves this number — `Media()` needs no second piece of "which one" state. */
  activeIndex: number | null;
  onNavigate: (index: number) => void;
  onClose: () => void;
  /** Translator closure — see `Media()`'s own `t`; forwarded to the `MediaPreview` this remounts. */
  t: (key: string) => string;
}

/**
 * Single shared lightbox for the whole Media grid — see this file's header comment for why one
 * shared instance is used instead of one per card. The chrome, keyboard, focus capture/return and
 * native-`<dialog>` lifecycle are Jini's shared `Lightbox` (`@jini-ai/ui/admin-widgets`); this only
 * supplies the asset, the translated labels and the agent handles.
 *
 * Renders the enlarged asset via the SAME `MediaPreview` the grid card uses (not a lightbox-
 * specific clone of the image/video/placeholder fallback chain) — `media.css`'s `.media-lightbox-
 * media` scope re-skins `.media-card-media`/`.media-card-placeholder` for a contain-fit, full-size
 * presentation purely in CSS, so the fallback logic itself (and the property that a defused
 * octet-stream asset lands on the placeholder with zero special-casing) is defined in exactly one
 * place.
 */
export function MediaLightbox(props: MediaLightboxProps & Pick<MediaProps, "kit">, _optional = {}) {
  const { kit } = props;
  const { Lightbox } = kit;
  const { items, activeIndex, onNavigate, onClose, t } = props;
  const item = resolveLightboxItem({ items, activeIndex });
  return (
    <Lightbox
      open={item !== null}
      title={item?.title ?? ""}
      index={activeIndex ?? 0}
      count={items.length}
      onNavigate={onNavigate}
      onClose={onClose}
      className="media-lightbox"
      labels={{ close: t("Close"), previous: t("Previous asset"), next: t("Next asset") }}
      partAttrs={{
        close: { ...agentHandle({ handle: "media-lightbox-close" }, { role: "button", label: "Close the lightbox" }) },
        previous: { ...agentHandle({ handle: "media-lightbox-prev" }, { role: "button", label: "Show the previous asset" }) },
        next: { ...agentHandle({ handle: "media-lightbox-next" }, { role: "button", label: "Show the next asset" }) },
      }}
    >
      {item ? (
        <div className="media-lightbox-media">
          {/* `key` is load-bearing, not a list-reconciliation habit: `useMediaPreview`'s `stage`
              is component state with no reset-on-`item` effect, and this ONE shared lightbox
              instance sits at a fixed tree position across prev/next. Without a changing key
              React keeps the instance, so a PDF that fell all the way through to `"unsupported"`
              leaves the next asset stuck on the placeholder even when it is a perfectly good
              image. The grid cards never hit this — each card owns its own instance. */}
          <MediaPreview kit={kit} useMediaPreviewHook={props.useMediaPreviewHook} key={item.id} item={item} t={t} />
        </div>
      ) : null}
    </Lightbox>
  );
}
