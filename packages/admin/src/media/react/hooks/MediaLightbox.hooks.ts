import { useEffect, useRef } from 'react';
import type { MediaAsset } from '../../models.js';
import type { MediaApiPort } from '../../ports.js';
export interface MediaLightboxProps {
  readonly items: readonly MediaAsset[];
  readonly api: MediaApiPort;
  readonly activeIndex: number | null;
  readonly onNavigate: (index: number) => void;
  readonly onClose: () => void;
}
export function useMediaLightbox(props: MediaLightboxProps, _optional: Record<string, never> = {}) {
  const item = props.activeIndex === null ? null : props.items[props.activeIndex] ?? null;
  function go(index: number) {
    // Clamps rather than wrapping: staying on the last asset is the less surprising
    // default for an operator navigating a specific set of uploads, not a slideshow.
    if (index >= 0 && index < props.items.length) {
      const focusedPart = dialogRef.current?.ownerDocument.activeElement?.getAttribute('data-jini-part');
      // Keep focus in the dialog when the focused arrow disappears at a boundary.
      // Interior navigation leaves focus where the operator put it.
      if ((index === 0 && focusedPart === 'media.lightbox.previous') ||
          (index === props.items.length - 1 && focusedPart === 'media.lightbox.next')) closeRef.current?.focus({ preventScroll: true });
      props.onNavigate(index);
    }
  }
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = !!item;
  useEffect(() => {
    // Close exists at every position, so it is a stable initial focus target. Only
    // opening focuses it; navigation must preserve the operator's current focus.
    if (open) closeRef.current?.focus();
  }, [open]);
  // Dialog owns open/close/focus, keyed on open rather than index: navigation must not
  // reopen an already-open dialog or recapture its trigger from inside the lightbox.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !item) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      if (props.activeIndex !== null) go(props.activeIndex + (event.key === 'ArrowRight' ? 1 : -1));
      // Native video controls may also seek while focused, as in the legacy lightbox.
      // Preview stage remains private, so do not silently infer it from contentType.
    };
    dialog.ownerDocument.addEventListener('keydown', onKey);
    return () => dialog.ownerDocument.removeEventListener('keydown', onKey);
  }, [props.activeIndex, props.items, props.onNavigate, !!item]);
  return {
    dialogRef,
    closeRef,
    title: item ? `Media preview: ${item.title}` : 'Media preview',
    position: item && props.activeIndex !== null ? `${props.activeIndex + 1} / ${props.items.length}` : '',
    ...props,
    item,
    open: !!item,
    hasPrev: props.activeIndex !== null && props.activeIndex > 0,
    hasNext: props.activeIndex !== null && props.activeIndex + 1 < props.items.length,
    previous: () => {
      if (props.activeIndex !== null) go(props.activeIndex - 1);
    },
    next: () => {
      if (props.activeIndex !== null) go(props.activeIndex + 1);
    },
  };
}
