import { useEffect, useRef, useState } from "react";

/**
 * @file The host's `SiteKeyTab.tsx` reveal panel's own copy-to-clipboard state — split out per the
 * `<Name>.tsx`/`<Name>.hooks.tsx` extraction pattern (the host's `AccessTokensTab.hooks.tsx` header).
 * Mirrors the host's dockerfile-source hook's `copy`/`copied` shape (`setTimeout(..., 1500)` reset),
 * scoped to just this one value rather than that hook's whole load/save/copy controller.
 */

export interface RevealedKeyCopyState {
  copied: boolean;
  /** Swallows a denied clipboard permission (insecure context, blocked permission) the same way
   *  the host's dockerfile-source hook's `copy` does — the key is still selectable/visible text on
   *  screen either way, so a failed copy never blocks the operator from saving it by hand. */
  copy: () => Promise<void>;
}

/** The clipboard write the host supplies; it rejects when the permission is denied. */
export interface RevealedKeyClipboard {
  writeText(text: string): Promise<void>;
}

/** The timer pair the host supplies, so the "Copied" reset never reaches a global timer here. */
export interface RevealedKeyScheduler {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** How long "Copied" stays on after a successful copy. */
const COPIED_RESET_MS = 1500;

export function useRevealedKeyCopy(
  { hex, clipboard, scheduler }: { hex: string; clipboard: RevealedKeyClipboard; scheduler: RevealedKeyScheduler },
  _optional: Record<string, never> = {}
): RevealedKeyCopyState {
  const [copied, setCopied] = useState(false);
  const resetHandle = useRef<unknown>(null);
  // Read through a ref so a host that builds its scheduler per render cannot cancel a live reset.
  const schedulerRef = useRef(scheduler);
  schedulerRef.current = scheduler;

  // A reset still pending when the panel hides must not fire into an unmounted component.
  useEffect(() => () => {
    if (resetHandle.current !== null) schedulerRef.current.clearTimeout(resetHandle.current);
  }, []);

  async function copy(): Promise<void> {
    try {
      await clipboard.writeText(hex);
      setCopied(true);
      if (resetHandle.current !== null) scheduler.clearTimeout(resetHandle.current);
      resetHandle.current = scheduler.setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      // Clipboard access denied — see this file's header.
    }
  }

  return { copied, copy };
}
