import type { Translate } from "../../i18n/dictionary-translator.js";
import { useEffect } from "react";

// JSON equality is intentionally limited to small form states built with consistent key order.
// This avoids a general deep-equality dependency; large documents or arbitrary values need another seam.
function shallowJsonEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type DirtyGuardHostPort = Pick<Window, "addEventListener" | "removeEventListener" | "confirm">;

export interface DirtyGuard {
  isDirty: boolean;
  // Also protect edits not yet flushed into current, even when the tracked state is still clean.
  confirmLeave: (required?: Record<string, never>, optional?: { unsavedBeyondTracked?: boolean }) => boolean;
}

/** @complexity O(n) per render in the serialized size of current/original; intended for small forms. */
/** Compare small JSON-serializable form states (including key order). Null original is clean.
 * Warn on unload and offer a translated native confirmation for caller-owned navigation. */
export function useDirtyGuard<T>({ current, original }: { current: T; original: T | null }, { translate = (key) => key, host = window }: { translate?: Translate | undefined; host?: DirtyGuardHostPort | undefined } = {}): DirtyGuard {
  // beforeunload covers close/reload/browser navigation, but does not fire for in-app routing.
  // Callers must wire confirmLeave to their own navigation actions or edits can be lost silently.
  const isDirty = original !== null && !shallowJsonEqual(current, original);

  useEffect(() => {
    if (!isDirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Both assignments are the standard cross-browser incantation (the returned string is
      // ignored by every modern browser in favor of their own fixed prompt copy, but the property
      // still has to be set for the prompt to appear at all in some engines).
      e.returnValue = "";
    }
    host.addEventListener("beforeunload", onBeforeUnload);
    return () => host.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty, host]);

  function confirmLeave(_required: Record<string, never> = {}, { unsavedBeyondTracked = false }: { unsavedBeyondTracked?: boolean } = {}): boolean {
    if (!isDirty && !unsavedBeyondTracked) return true;
    return host.confirm(translate("You have unsaved changes. Leave without saving?"));
  }

  return { isDirty, confirmLeave };
}

