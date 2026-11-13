import { useRef, useState } from 'react';
import { useDismissOnOutsideOrEscape } from '../../../../browser/index.js';

/** Close the disclosure before invoking the selected host action. */
export function usePresentMenu(_input: Record<string, never>, _options = {}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutsideOrEscape({ onDismiss: () => setOpen(false) }, { enabled: open, containerRef: wrapRef });
  function select(action: () => void) {
    setOpen(false);
    action();
  }
  return { open, setOpen, wrapRef, select };
}
