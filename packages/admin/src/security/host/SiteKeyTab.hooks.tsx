import { useState } from "react";

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

export function useRevealedKeyCopy({ hex }: { hex: string }, _optional: Record<string, never> = {}): RevealedKeyCopyState {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied — see this file's header.
    }
  }

  return { copied, copy };
}
