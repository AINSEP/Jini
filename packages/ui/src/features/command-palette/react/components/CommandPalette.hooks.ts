import { useCallback, useEffect, useRef } from 'react';

/** The element focus should return to once the palette has closed. */
function isRestorable(candidate: Element | null, input: HTMLInputElement): candidate is HTMLElement {
  return candidate instanceof HTMLElement && candidate !== input && candidate !== input.ownerDocument.body;
}

/**
 * Focus the palette's input on attach (remembering where focus came from) and
 * keep the active result visible.
 */
export function useCommandPaletteView({ cursor }: { cursor: number }, _options = {}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const setInputRef = useCallback((node: HTMLInputElement | null) => {
    if (node) {
      // Focus must be captured BEFORE the input takes it: afterwards the opener is
      // unrecoverable. Read from the input's own document so an iframe/popout host works.
      const previous = node.ownerDocument.activeElement;
      openerRef.current = isRestorable(previous, node) ? previous : null;
      inputRef.current = node;
      node.focus();
      return;
    }
    const input = inputRef.current;
    const opener = openerRef.current;
    inputRef.current = null;
    openerRef.current = null;
    if (!input || !opener?.isConnected) return;
    // React detaches the ref at commit time, before the input leaves the DOM, so a
    // palette that still owns focus shows up as the input; a removal that already
    // dropped focus shows up as the body. Anything else means the host deliberately
    // moved focus (e.g. from onClose) and must not be reclaimed.
    const active = input.ownerDocument.activeElement;
    if (active === input || active === input.ownerDocument.body || active === null) opener.focus();
  }, []);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLDivElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);
  return { listRef, setInputRef };
}
