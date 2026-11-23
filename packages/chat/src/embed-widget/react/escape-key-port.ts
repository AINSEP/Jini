import type { EscapeKeyPort } from './header.js';

/** The two listener methods the port needs; `null` when the host document has no view. */
export type EscapeKeyView = Pick<Window, 'addEventListener' | 'removeEventListener'> | null;

/**
 * Default {@link EscapeKeyPort} over a host window. The listener runs in the capture phase and
 * calls `preventDefault()` so a confirm-step Escape is consumed before the containing dialog
 * closes: `useEmbedChatDialog` listens in the bubble phase and skips an already-prevented Escape.
 * @complexity O(1) per keydown; one listener per live subscription.
 */
export function createViewEscapeKeyPort({ view }: { view: EscapeKeyView }, _optional = {}): EscapeKeyPort {
  return {
    subscribe: ({ onEscape }) => {
      const handler = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onEscape();
      };
      view?.addEventListener('keydown', handler, true);
      return () => view?.removeEventListener('keydown', handler, true);
    },
  };
}
