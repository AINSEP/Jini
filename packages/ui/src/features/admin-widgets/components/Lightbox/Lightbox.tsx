import { useId, type ReactNode } from "react";

import { Icon } from "../../../../react/components/Icon.js";
import { LIGHTBOX_DISMISS_ATTR, useLightbox } from "./Lightbox.hooks.js";

type LightboxPart = "dialog" | "close" | "previous" | "next";

export interface LightboxProps {
  open: boolean;
  /** Shown above the media (usually the file name) and used as the dialog's accessible name. */
  title: string;
  onClose: () => void;
  /** The media itself. `img`/`video` children are contain-fit to the viewport and never upscaled. */
  children?: ReactNode;
  /** Zero-based position and set size; with `onNavigate` and `count > 1` the arrow pair renders. */
  index?: number | undefined;
  count?: number | undefined;
  onNavigate?: ((index: number) => void) | undefined;
  /** Caller-specific controls (download, copy, metadata), placed bottom-left opposite the arrows. */
  actions?: ReactNode;
  /** No locale is owned here; a translated caller passes its own accessible labels. */
  labels?: Partial<Record<"close" | "previous" | "next", string>> | undefined;
  /** Extra class on the `<dialog>` so a caller can scope its own media rules. */
  className?: string | undefined;
  /** Per-part attributes (agent handles, `data-jini-part` markers) without the shell knowing them. */
  partAttrs?: Partial<Record<LightboxPart, Record<string, string>>> | undefined;
  /** A fake controller can exercise rendering without a real native-dialog lifecycle. */
  useLightboxHook?: typeof useLightbox | undefined;
}

const DEFAULT_LABELS = { close: "Close preview", previous: "Previous", next: "Next" } as const;

// Native dialog supplies the focus trap, Escape and top-layer stacking, so there is no hand-built
// overlay or z-index policy. The dialog itself fills the viewport as the dark gray stage (rather
// than a card over a dim backdrop) so the media can take nearly all of the screen.
/** Full-viewport media lightbox: title and counter top-left, close top-right, the media as large
 *  as fits, caller actions bottom-left and the previous/next pair together bottom-right. */
export function Lightbox(props: LightboxProps) {
  const { open, title, children, actions, className, partAttrs = {}, useLightboxHook = useLightbox } = props;
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  const titleId = useId();
  const vm = useLightboxHook({ open, onClose: props.onClose, index: props.index, count: props.count, onNavigate: props.onNavigate });

  return (
    <dialog
      ref={vm.dialogRef}
      className={className ? `jini-lightbox ${className}` : "jini-lightbox"}
      aria-labelledby={open ? titleId : undefined}
      onCancel={vm.handleCancel}
      onClick={vm.handleClick}
      onKeyDown={vm.handleKeyDown}
      {...partAttrs.dialog}
    >
      {open ? (
        <>
          <header className="jini-lightbox-header">
            <h2 id={titleId} className="jini-lightbox-title" title={title}>{title}</h2>
            {vm.counter ? <span className="jini-lightbox-counter">{vm.counter}</span> : null}
            <button type="button" ref={vm.closeRef} className="jini-lightbox-button jini-lightbox-close" aria-label={labels.close} onClick={props.onClose} {...partAttrs.close}>
              <Icon name="close" size={16} strokeWidth={1.8} />
            </button>
          </header>
          <div className="jini-lightbox-stage" {...{ [LIGHTBOX_DISMISS_ATTR]: "" }}>{children}</div>
          {actions || vm.navigable ? (
            <footer className="jini-lightbox-footer">
              <div className="jini-lightbox-actions">{actions}</div>
              {vm.navigable ? (
                <div className="jini-lightbox-nav">
                  <button type="button" ref={vm.prevRef} className="jini-lightbox-button" aria-label={labels.previous} disabled={!vm.hasPrev} onClick={vm.previous} {...partAttrs.previous}>
                    <Icon name="chevron-left" size={18} strokeWidth={1.8} />
                  </button>
                  <button type="button" ref={vm.nextRef} className="jini-lightbox-button" aria-label={labels.next} disabled={!vm.hasNext} onClick={vm.next} {...partAttrs.next}>
                    <Icon name="chevron-right" size={18} strokeWidth={1.8} />
                  </button>
                </div>
              ) : null}
            </footer>
          ) : null}
        </>
      ) : null}
    </dialog>
  );
}
