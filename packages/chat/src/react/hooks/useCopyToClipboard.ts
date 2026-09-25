/**
 * @module useCopyToClipboard
 *
 * Copies a string to the system clipboard and exposes a transient `copied`
 * flag a UI affordance can key off of (icon swap, status text, ...). This is
 * the shared primitive behind the per-message copy button in `MessageRow.tsx`
 * -- kept here, not inlined there, so the per-block copy button
 * `Markdown.tsx` still has as a TODO can reuse the same copy/fallback logic
 * once it's built, without duplicating the secure-context handling below.
 *
 * Two copy paths, tried in order:
 * 1. `navigator.clipboard.writeText` -- the modern async Clipboard API.
 *    Requires a secure context (HTTPS, or `localhost`); rejects everywhere
 *    else, and can also reject in a secure context that denies clipboard
 *    permission.
 * 2. A hidden, focused, selected `<textarea>` + `document.execCommand('copy')`
 *    -- deprecated, but still the only synchronous copy path browsers expose
 *    outside a secure context. This package ships to hosts beyond localhost,
 *    so the secure-context requirement above can't be assumed.
 *
 * Both paths report their own success back to the caller (rather than being
 * assumed to have worked) so a caller can decide how to react to a copy that
 * silently failed instead of showing a false "Copied" state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** How long the `copied` flag stays true after a successful copy before it reverts on its own. */
const COPIED_RESET_MS = 1500;

/**
 * Synchronous fallback copy path for non-secure contexts: a hidden textarea
 * gets the text, is selected, and `execCommand('copy')` is invoked against
 * that selection. Returns whether the browser reports the command as
 * executed -- `execCommand` itself throws in some embedding contexts (e.g. a
 * sandboxed iframe without clipboard-write) rather than just returning
 * `false`, so this also guards with try/catch.
 * @param text - The exact string to place on the clipboard.
 * @returns Whether the copy command executed successfully.
 * @complexity O(1) -- one DOM node created, selected, and removed.
 */
function copyViaExecCommand(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  // Off-screen but still focusable/selectable: a `display:none` element can't hold a selection.
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.left = '-1000px';
  textarea.setAttribute('readonly', '');
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

export interface UseCopyToClipboardResult {
  /** `true` for `COPIED_RESET_MS` after a successful `copy()` call, then reverts to `false` on its own. */
  copied: boolean;
  /** Copies `text` verbatim. Resolves to whether the copy actually succeeded. */
  copy: (text: string) => Promise<boolean>;
}

/**
 * React hook wrapping the copy-to-clipboard logic above with the transient
 * `copied` UI flag callers use to drive an icon swap or status announcement.
 * @returns The current `copied` flag and a `copy` function to invoke it.
 * @complexity O(1) per `copy()` call (excluding the clipboard API's own cost).
 */
export function useCopyToClipboard(): UseCopyToClipboardResult {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Clears any pending reset on unmount so a copy just before navigating away never calls
  // setState on an unmounted component.
  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    let ok = false;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        // Denied permission, or a non-secure context where the API exists but rejects every call.
        ok = copyViaExecCommand(text);
      }
    } else {
      ok = copyViaExecCommand(text);
    }
    if (ok) {
      setCopied(true);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    }
    return ok;
  }, []);

  return { copied, copy };
}
