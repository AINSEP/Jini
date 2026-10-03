// Copies text to the clipboard using the canonical Clipboard API, falling
// back to a hidden textarea + execCommand('copy') for older browsers,
// locked-clipboard contexts, or insecure (HTTP) origins where
// navigator.clipboard.writeText rejects.

export interface ClipboardWritePort {
  writeText(requiredArgs: { text: string }): Promise<void>;
}

export interface CopyToClipboardOptions {
  clipboard?: ClipboardWritePort;
  document?: Document;
  isHTMLElement?: (requiredArgs: { value: Element | null }) => boolean;
}

/**
 * Copy `requiredArgs.text` to the system clipboard.
 * Optional ports replace the clipboard writer, fallback document and element check.
 * Returns true on success through either strategy, false when both writes fail.
 * O(1): one clipboard write and a single temporary textarea on rejection.
 */
export async function copyToClipboard(
  { text }: { text: string },
  options: CopyToClipboardOptions = {},
): Promise<boolean> {
  try {
    if (options.clipboard) await options.clipboard.writeText({ text });
    else await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const document = options.document ?? globalThis.document;
    const isHTMLElement = options.isHTMLElement ?? (({ value }: { value: Element | null }) => value instanceof HTMLElement);
    const priorFocus = isHTMLElement({ value: document.activeElement })
      ? document.activeElement as HTMLElement
      : null;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    // Cleanup is repeated at each return point rather than living in a
    // `finally` clause: this `try`'s own `catch { return false; }` can
    // never itself throw, so a `finally` here would carry v8's synthetic
    // "abrupt completion through finally" branch permanently unreachable —
    // same dead-branch discipline as this repo's `daemon/tool-executor.ts`
    // and `packages/ui`'s `useMemoryExtractions.hooks.ts` precedents (see
    // packages/ui/archived provenance ledger's 2026-07-22 dated entry).
    const cleanup = () => {
      document.body.removeChild(ta);
      if (priorFocus?.isConnected) {
        try {
          priorFocus.focus({ preventScroll: true });
        } catch {
          priorFocus.focus();
        }
      }
    };
    try {
      const result = document.execCommand('copy');
      cleanup();
      return result;
    } catch {
      cleanup();
      return false;
    }
  }
}
