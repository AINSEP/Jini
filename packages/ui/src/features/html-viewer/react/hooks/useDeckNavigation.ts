import { useCallback, useMemo, useState } from 'react';
import type { RefObject } from 'react';
import { useSandboxBridge } from '@injini/renderers-react';
import { DECK_NAVIGATE_MESSAGE_TYPE, DECK_STATE_MESSAGE_TYPE } from '../../constants.js';
import { canGoNext, canGoPrev, parseDeckStateMessage, slideCounterLabel } from '../../rules.js';
import type { DeckNavigateAction, DeckSlideState } from '../../types.js';

export interface DeckNavigationController {
  /** `null` until the sandboxed content's own deck framework reports its first state. */
  slideState: DeckSlideState | null;
  /** `"N / total"`, or `null` when there is no deck state yet. */
  counterLabel: string | null;
  canGoPrev: boolean;
  canGoNext: boolean;
  goNext(): void;
  goPrev(): void;
  goFirst(): void;
  goLast(): void;
  goTo(index: number): void;
}

/**
 * Drives deck/slide navigation over `@injini/renderers-react`'s
 * `useSandboxBridge`, speaking the neutral `jini:deck-*` protocol from
 * `constants.ts`. The sandboxed content itself must implement the deck
 * framework that responds to these messages — this hook only sends
 * navigation requests and tracks the state the content reports back.
 */
export function useDeckNavigation(
  iframeRef: RefObject<HTMLIFrameElement | null>,
): DeckNavigationController {
  const [slideState, setSlideState] = useState<DeckSlideState | null>(null);

  const handlers = useMemo(
    () => ({
      [DECK_STATE_MESSAGE_TYPE]: (message: { type: string }) => {
        const next = parseDeckStateMessage(message);
        if (next) setSlideState(next);
      },
    }),
    [],
  );

  const { post } = useSandboxBridge({ iframeRef, handlers });

  const navigate = useCallback(
    (action: DeckNavigateAction, index?: number) => {
      post({ type: DECK_NAVIGATE_MESSAGE_TYPE, action, ...(index !== undefined ? { index } : {}) });
    },
    [post],
  );

  return {
    slideState,
    counterLabel: slideCounterLabel(slideState),
    canGoPrev: canGoPrev(slideState),
    canGoNext: canGoNext(slideState),
    goNext: useCallback(() => navigate('next'), [navigate]),
    goPrev: useCallback(() => navigate('prev'), [navigate]),
    goFirst: useCallback(() => navigate('first'), [navigate]),
    goLast: useCallback(() => navigate('last'), [navigate]),
    goTo: useCallback((index: number) => navigate('go', index), [navigate]),
  };
}
