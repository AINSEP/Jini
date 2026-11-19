import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserNavigationEntry, BrowserNavigationState } from '../../types.js';
import { DEFAULT_HOME_NAVIGATION_ENTRY, EMPTY_URL } from '../../constants.js';
import {
  initialNavigationState,
  recordNavigation as recordNavigationRule,
  resolveNavigationHistoryDelta,
  updateCurrentNavigationTitle,
  canGoBack as canGoBackRule,
  canGoForward as canGoForwardRule,
  type RecordNavigationOptions,
} from '../../rules.js';

export interface UseBrowserNavigationStackOptions {
  initialUrl?: string;
  initialTitle?: string;
  homeEntry?: BrowserNavigationEntry;
  /** Fired whenever the current navigation entry changes (host's `onNavigate` port). */
  onNavigate?: (entry: BrowserNavigationEntry) => void;
}

export interface BrowserNavigationController {
  navigationStack: BrowserNavigationEntry[];
  navigationIndex: number;
  currentEntry: BrowserNavigationEntry | undefined;
  addressValue: string;
  canGoBack: boolean;
  canGoForward: boolean;
  recordNavigation: (url: string, title?: string, options?: RecordNavigationOptions) => void;
  goBack: () => BrowserNavigationEntry | null;
  goForward: () => BrowserNavigationEntry | null;
  updateCurrentTitle: (title?: string) => void;
  reset: (initialUrl?: string, initialTitle?: string) => void;
}

export function useBrowserNavigationStack(options: UseBrowserNavigationStackOptions = {}): BrowserNavigationController {
  const homeEntry = options.homeEntry ?? DEFAULT_HOME_NAVIGATION_ENTRY;
  const initial = initialNavigationState({}, { initialUrl: options.initialUrl, initialTitle: options.initialTitle, homeEntry });
  const [state, setState] = useState<BrowserNavigationState>({
    navigationStack: initial.navigationStack,
    navigationIndex: initial.navigationIndex,
  });
  const [addressValue, setAddressValue] = useState(initial.addressValue);

  const onNavigateRef = useRef(options.onNavigate);
  onNavigateRef.current = options.onNavigate;
  const lastNotifiedRef = useRef<BrowserNavigationEntry | undefined>(undefined);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Non-null assertion, not a guard: every state transition this hook
  // performs (initialNavigationState / recordNavigation /
  // resolveNavigationHistoryDelta / updateCurrentNavigationTitle, all in
  // rules.ts) preserves `navigationStack.length >= 1` and
  // `0 <= navigationIndex < navigationStack.length`, so this index read is
  // always in range at runtime — `noUncheckedIndexedAccess` just can't prove
  // that statically.
  const currentEntry = state.navigationStack[state.navigationIndex]!;

  useEffect(() => {
    const last = lastNotifiedRef.current;
    if (last && last.url === currentEntry.url && last.title === currentEntry.title) return;
    lastNotifiedRef.current = currentEntry;
    onNavigateRef.current?.(currentEntry);
  }, [currentEntry]);

  const recordNavigation = useCallback((url: string, title?: string, recordOptions?: RecordNavigationOptions) => {
    setState((current) => recordNavigationRule({ state: current, url }, { title, options: { homeLabel: homeEntry.title, ...(recordOptions ?? {}) } }));
    setAddressValue(url === EMPTY_URL ? '' : url);
  }, [homeEntry.title]);

  const navigateHistoryDelta = useCallback((delta: -1 | 1): BrowserNavigationEntry | null => {
    const result = resolveNavigationHistoryDelta({ state: stateRef.current, delta });
    if (!result) return null;
    setState(result.state);
    setAddressValue(result.entry.url === EMPTY_URL ? '' : result.entry.url);
    return result.entry;
  }, []);

  const goBack = useCallback((): BrowserNavigationEntry | null => navigateHistoryDelta(-1), [navigateHistoryDelta]);
  const goForward = useCallback((): BrowserNavigationEntry | null => navigateHistoryDelta(1), [navigateHistoryDelta]);

  const updateCurrentTitle = useCallback((title?: string) => {
    setState((current) => updateCurrentNavigationTitle({ state: current }, { title }));
  }, []);

  const reset = useCallback((initialUrl?: string, initialTitle?: string) => {
    const next = initialNavigationState({}, { initialUrl, initialTitle, homeEntry });
    setState({ navigationStack: next.navigationStack, navigationIndex: next.navigationIndex });
    setAddressValue(next.addressValue);
    lastNotifiedRef.current = undefined;
  }, [homeEntry]);

  return {
    navigationStack: state.navigationStack,
    navigationIndex: state.navigationIndex,
    currentEntry,
    addressValue,
    canGoBack: canGoBackRule(state),
    canGoForward: canGoForwardRule(state),
    recordNavigation,
    goBack,
    goForward,
    updateCurrentTitle,
    reset,
  };
}
