import { useEffect, useRef, type MouseEvent, type RefObject, type SyntheticEvent } from "react";

/**
 * Lifecycle for the shared `Lightbox`: native `<dialog>` open/close, focus capture and return,
 * arrow-key navigation, Escape and backdrop dismissal. Absorbs the open/close and focus logic the
 * media lightboxes and `ImagePreviewModal` each carried, so every caller gets the same behavior.
 */

/** Idempotent native open. `showModal()` throws on an already-open dialog in real browsers; the
 *  attribute fallback covers DOM environments without it (jsdom). */
export function openLightboxDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
    return;
  }
  dialog.setAttribute("open", "");
}

/** The close-side mirror of {@link openLightboxDialog} — same fallback and already-closed guard. */
export function closeLightboxDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === "function") {
    if (dialog.open) dialog.close();
    return;
  }
  dialog.removeAttribute("open");
}

export interface LightboxHookInput {
  open: boolean;
  onClose: () => void;
  /** Zero-based position in the set; with `count > 1` and `onNavigate` the arrow pair renders. */
  index?: number | undefined;
  count?: number | undefined;
  onNavigate?: ((index: number) => void) | undefined;
}

export interface LightboxController {
  dialogRef: RefObject<HTMLDialogElement | null>;
  closeRef: RefObject<HTMLButtonElement | null>;
  prevRef: RefObject<HTMLButtonElement | null>;
  nextRef: RefObject<HTMLButtonElement | null>;
  /** Whether the arrow pair renders at all (a single item has nowhere to go). */
  navigable: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  /** "3 / 12", or "" when there is no set to count. */
  counter: string;
  previous: () => void;
  next: () => void;
  handleCancel: (event: SyntheticEvent<HTMLDialogElement>) => void;
  handleClick: (event: MouseEvent<HTMLDialogElement>) => void;
}

/** Marks the stage's empty area: the dialog fills the viewport, so "backdrop" is any click that
 *  lands on the dialog itself or the stage around the media rather than on a control or the media. */
export const LIGHTBOX_DISMISS_ATTR = "data-jini-lightbox-dismiss";

function isDismissTarget(target: EventTarget | null): boolean {
  return target instanceof Element && (target.tagName === "DIALOG" || target.hasAttribute(LIGHTBOX_DISMISS_ATTR));
}

function navState(input: LightboxHookInput) {
  const count = input.count ?? 0;
  const index = input.index ?? 0;
  const navigable = count > 1 && typeof input.onNavigate === "function";
  return { count, index, navigable, hasPrev: navigable && index > 0, hasNext: navigable && index + 1 < count };
}

export function useLightbox(input: LightboxHookInput): LightboxController {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  // Captured when the dialog opens, before focus moves inside: by construction the element that
  // opened it (a card's expand button). Restored on close so keyboard users land where they were.
  const triggerRef = useRef<Element | null>(null);
  const pendingFocusRef = useRef<RefObject<HTMLButtonElement | null> | null>(null);
  const nav = navState(input);

  useEffect(() => {
    pendingFocusRef.current?.current?.focus({ preventScroll: true });
    pendingFocusRef.current = null;
  }, [input.index]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (input.open) {
      triggerRef.current = dialog.ownerDocument.activeElement;
      openLightboxDialog(dialog);
      // Close exists at every position (a single item has no arrows), so it is the stable initial
      // focus target. Only opening focuses it; navigation preserves the operator's current focus.
      closeRef.current?.focus({ preventScroll: true });
      return;
    }
    closeLightboxDialog(dialog);
    const trigger = triggerRef.current as { focus?: (options?: FocusOptions) => void } | null;
    trigger?.focus?.({ preventScroll: true });
    // Keyed on `open`, not `index`: navigating while open must not reopen the dialog (showModal on
    // an open dialog throws) or recapture its trigger from inside the lightbox.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.open]);

  function go(target: number) {
    // Clamps rather than wrapping: staying on the last asset is the less surprising default for an
    // operator navigating a specific set of uploads, not a slideshow.
    if (!nav.navigable || target < 0 || target >= nav.count) return;
    // An arrow becomes disabled at its end, and a disabled focused button drops focus out of the
    // dialog. Hand focus to its neighbour first; interior moves leave focus where the operator put it.
    // The neighbour may itself be disabled until the caller re-renders, so the move is applied
    // after the index changes.
    const active = dialogRef.current?.ownerDocument.activeElement;
    if (target === 0 && active === prevRef.current) pendingFocusRef.current = nextRef;
    if (target === nav.count - 1 && active === nextRef.current) pendingFocusRef.current = prevRef;
    input.onNavigate?.(target);
  }

  // Listens on the document rather than the dialog: when the focused media is swapped out (an
  // image that failed over to a video) focus drops to the body, and arrow keys must keep working.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !input.open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      // Known limitation: a focused `<video controls>` also seeks on these keys natively, so the
      // press both seeks and navigates. Callers know their media; the shell does not.
      event.preventDefault();
      go(nav.index + (event.key === "ArrowRight" ? 1 : -1));
    };
    dialog.ownerDocument.addEventListener("keydown", onKey);
    return () => dialog.ownerDocument.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.open, nav.index, nav.count, input.onNavigate]);

  return {
    dialogRef,
    closeRef,
    prevRef,
    nextRef,
    navigable: nav.navigable,
    hasPrev: nav.hasPrev,
    hasNext: nav.hasNext,
    counter: nav.count > 1 ? `${nav.index + 1} / ${nav.count}` : "",
    previous: () => go(nav.index - 1),
    next: () => go(nav.index + 1),
    // Always prevented so the `open` prop stays the single source of truth; Escape routes through
    // onClose and the caller's state change is what actually closes the dialog.
    handleCancel: (event) => {
      event.preventDefault();
      input.onClose();
    },
    handleClick: (event) => {
      if (isDismissTarget(event.target)) input.onClose();
    },
  };
}
