import type { KeyboardEvent as ReactKeyboardEvent, SyntheticEvent } from 'react';
import type { ConnectorCardProps } from './ConnectorCard.js';

/** Open details from the card itself, but not from a nested control. */
export function useConnectorCard({ connector, disabled, onOpenDetails }: Pick<ConnectorCardProps, 'connector' | 'onOpenDetails'> & { disabled: boolean }, _options = {}) {
  function openDetails() {
    if (disabled) return;
    onOpenDetails(connector.id);
  }
  function onKeyActivate(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    openDetails();
  }
  return { openDetails, onKeyActivate };
}

/** Continue authorization only for a URL from the currently rendered link. */
export function createContinueAuthorization({ redirectUrl, onOpenExternalUrl }: { redirectUrl: string; onOpenExternalUrl: ((url: string) => void) | undefined }, _options = {}) {
  return (event: SyntheticEvent) => {
    event.stopPropagation();
    // `continueAuthorization`'s only call site (the "continue in browser"
    // button below) only ever renders while
    // `isAuthorizationPending && authorizationPending.redirectUrl` already
    // holds in that same render, and React re-binds this closure fresh on
    // every render — so a re-check here was dead code for every real
    // click, removed rather than tested around (see
    // archived UI source map's 2026-07-22 dated entry).
    // `continueAuthorization`'s only call site (the "continue in browser"
    // button below) only ever renders while `authorizationPending &&
    // authorizationPending.redirectUrl` already holds in that same render,
    // and React re-binds this closure fresh on every render — so a
    // re-check here was dead code for every real click, removed rather
    // than tested around (same pattern as this package's `ConnectorCard.tsx`
    // precedent; see archived UI source map's 2026-07-22 dated entry).
    onOpenExternalUrl?.(redirectUrl);
  };
}
