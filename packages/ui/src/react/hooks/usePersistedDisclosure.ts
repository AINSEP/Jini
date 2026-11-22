// Open/closed state of a collapsible panel, persisted per browser in localStorage under a
// host-supplied key. Every read and write is best-effort: localStorage throws outright in some
// privacy modes, and a failed read falls back to collapsed (the default), so the worst case is the
// panel starting closed again. Not tied to any one feature domain — feature-local hooks live
// inside their own `features/<domain>/react/hooks/` instead.
import { useCallback, useId, useState } from 'react';

/** @complexity Time/space: O(1). */
function readOpen({ storageKey }: { storageKey: string }): boolean {
  try {
    return localStorage.getItem(storageKey) === '1';
  } catch {
    return false;
  }
}

/** @complexity Time/space: O(1). */
function writeOpen({ storageKey, open }: { storageKey: string; open: boolean }): void {
  try {
    localStorage.setItem(storageKey, open ? '1' : '0');
  } catch {
    // best-effort; see this file's header.
  }
}

export interface PersistedDisclosure {
  open: boolean;
  toggle: () => void;
  /** DOM id for the collapsible body, so the header button can point `aria-controls` at it. */
  panelId: string;
}

/**
 * Stores `"1"` under `storageKey` while open; any other value, or none, means collapsed.
 * @example
 * const { open, toggle, panelId } = usePersistedDisclosure({ storageKey: 'app.panel.open' });
 */
export function usePersistedDisclosure(
  { storageKey }: { storageKey: string },
  _optional: Record<string, never> = {},
): PersistedDisclosure {
  const [open, setOpen] = useState(() => readOpen({ storageKey }));
  const panelId = useId();
  const toggle = useCallback(() => {
    setOpen((previous) => {
      writeOpen({ storageKey, open: !previous });
      return !previous;
    });
  }, [storageKey]);
  return { open, toggle, panelId };
}
