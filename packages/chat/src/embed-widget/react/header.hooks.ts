import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EmbedChatHeaderArgs } from './header.js';

/** Confirm discarding messages or a live draft; Cancel/Escape restore the reset button.
 * @complexity O(pane controls + draft length) per request; O(1) retained state.
 */
export function useEmbedChatHeader({ hasMessages, onReset, keyboard }: Pick<EmbedChatHeaderArgs,
  'hasMessages' | 'onReset' | 'keyboard'>, _options = {}) {
  const [confirming, setConfirming] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const cancel = () => setConfirming(false);
  useLayoutEffect(() => {
    if (wasConfirming.current && !confirming) resetButtonRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  useEffect(() => {
    if (!confirming) return undefined;
    return keyboard.subscribe({ onEscape: () => setConfirming(false) });
  }, [confirming, keyboard]);
  return { confirming, cancel, headerRef, resetButtonRef,
    requestReset: () => {
      // The pane owns the draft; inspect its live composer rather than keeping a second copy.
      const composer = headerRef.current?.closest('.jini-chat-pane')?.querySelector<HTMLTextAreaElement>('.jini-composer-input');
      if (hasMessages || composer?.value) setConfirming(true);
      else onReset();
    },
    confirmReset: () => { setConfirming(false); onReset(); },
  };
}
