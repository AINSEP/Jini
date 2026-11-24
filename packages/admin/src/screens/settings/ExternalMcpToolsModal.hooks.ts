import { useEffect, useRef, type RefObject } from "react";

import type { AdminKitHooks } from "../../react/kit.js";

/**
 * @file `ExternalMcpToolsModal.tsx`'s own derived-value logic, split out per the
 * `<Name>.tsx`/`<Name>.hooks.tsx` pattern (admin TSX-logic-sweep, 2026-09-05) — this repo's rule
 * that a `.tsx` file carries no functions or derived logic of its own. Mirrors
 * `hooks/use-external-mcp-remove-confirm.hooks.ts`'s own Escape-to-cancel effect (same listener,
 * same cleanup). Kept as this modal's OWN copy rather than importing that file's hook: the two
 * dialogs are otherwise unrelated (that one also derives remove-confirmation copy, which this modal
 * has no equivalent of), and that file's own header already gives the reasoning for not sharing an
 * 8-line effect across a second caller — the point to extract a shared one is a THIRD consumer, not
 * two.
 *
 * Now also owns the Tab trap (2026-09-20 focus-trap inventory, plan-components.md Part 3): this
 * modal declares `aria-modal="true"` but nothing kept Tab from walking out onto the page behind it.
 * `dialogRef`/`useFocusTrap` are returned from here rather than created in the `.tsx` body, for the
 * same "ref and its consuming hook stay together" reason `use-external-mcp-remove-confirm.hooks.ts`
 * gives.
 *
 * Also owns the open/close focus transition (2026-09-21), the same regression `4d52c7783` fixed for
 * `MediaEditDialog`: this modal is conditionally mounted by its caller (`ExternalMcpSettingsPanel.tsx`'s
 * `toolsOpen ? <ExternalMcpToolsModal .../> : null`), so mount/unmount IS the open/close transition —
 * same technique `MediaPickerDialog.hooks.tsx`'s `useMediaPickerDialog` uses for its own `cancelRef`.
 * The sibling `ExternalMcpRemoveConfirmDialog` gets this for free via a plain `autoFocus` on its
 * Cancel button, but this modal's own first control (the picker's Refresh/Cancel/Save buttons) is
 * conditional on picker load state — the modal's own Close button is the one control guaranteed
 * present regardless, the same "stable target present regardless of draft state" reasoning
 * `MediaEditDialogController`'s `altRef` doc gives, so it is the focus target here instead.
 */

export interface ExternalMcpToolsModalController {
  /** Attach to the modal's own `aria-modal` root — see this file's header. */
  dialogRef: RefObject<HTMLDivElement | null>;
  /** Attach to the modal's own Close button — see this file's header's focus-transition section. */
  closeRef: RefObject<HTMLButtonElement | null>;
}

/** Calls `onClose` when Escape is pressed anywhere in the document, for as long as the modal stays
 *  mounted, traps Tab inside the returned `dialogRef`, and moves focus onto `closeRef` on mount,
 *  restoring it to whatever had focus beforehand on unmount — see this file's header.
 *
 *  @complexity O(1) per keypress; one listener for the lifetime of the mount. */
export function useExternalMcpToolsModalEscape({ onClose, useFocusTrapHook }: { onClose: () => void; useFocusTrapHook: AdminKitHooks['useFocusTrap'] }, _options = {}): ExternalMcpToolsModalController {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useFocusTrapHook({ containerRef: dialogRef });

  // Captured at mount, before focus moves onto Close below — the element that had focus then is,
  // by construction, whatever opened this modal (the row's "Tools" button). Restored on unmount.
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    triggerRef.current = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return { dialogRef, closeRef };
}
