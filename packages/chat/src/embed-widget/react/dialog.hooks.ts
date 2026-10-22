import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useFocusTrap } from '@jini-ai/ui/panel-kit';

/**
 * Shares the panel-kit trap across embeds. Escape respects a child popup's preventDefault;
 * Closing restores the mounted launcher, including after a lazy-loader handoff.
 * A changed resetKey focuses the replacement composer after the host remounts the pane.
 * @complexity O(focusable controls) per Tab; O(1) listeners and retained state.
 */
export function useEmbedChatDialog({ open, onClose, panelRef, launcherRef }: {
  open: boolean; onClose: () => void;
  panelRef: RefObject<HTMLElement | null>; launcherRef: RefObject<HTMLElement | null>;
}, { resetKey }: { resetKey?: number | undefined } = {}): void {
  const wasOpen = useRef(open);
  const previousResetKey = useRef(resetKey);
  useFocusTrap({ containerRef: panelRef }, { active: open });
  useLayoutEffect(() => {
    if (open && previousResetKey.current !== resetKey) {
      panelRef.current?.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)')?.focus();
    }
    previousResetKey.current = resetKey;
  }, [open, resetKey, panelRef]);
  useEffect(() => {
    if (wasOpen.current && !open) {
      const launcher = launcherRef.current;
      (launcher?.querySelector<HTMLElement>('button') ?? launcher)?.focus();
    }
    wasOpen.current = open;
  }, [open, launcherRef]);
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const view = panel?.ownerDocument.defaultView;
    if (!panel || !view) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
      }
    };
    view.addEventListener('keydown', onKeyDown);
    return () => view.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, panelRef]);
}

/** Reusable state/ref wiring for the packaged embed. O(1) besides the shared trap's Tab scan. */
export function useEmbedChatSurface({ initialOpen }: { initialOpen: boolean }, { resetKey }: { resetKey?: number | undefined } = {}) {
  const [open, setOpen] = useState(initialOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen(current => !current), []);
  useEmbedChatDialog({ open, onClose: close, panelRef, launcherRef }, { resetKey });
  return { open, toggle, panelRef, launcherRef, panelId };
}
