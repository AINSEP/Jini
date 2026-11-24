/**
 * @file Live views: how many open tabs keep a running `<webview>` guest at once.
 *
 * Every guest is a whole Chromium renderer process plus the site's own bundle, so ten open tabs
 * used to mean ten of them, nine hidden. The limit (the host's "loaded sites" setting) is SOFT: the
 * tab on screen always mounts its guest, and only then does this hook look for a hidden one to
 * release, least recently focused first. A guest is released only when it agrees to be.
 *
 * **The release probe.** The host's probe script, run through `webview.executeJavaScript`,
 * dispatches a cancelable `beforeunload` and a cancelable `jini:release-check` on the guest's
 * `window`, then reads whether either was prevented. `beforeunload` is what every editor's dirty
 * guard already answers, so a post with unsaved edits keeps its guest without any new code;
 * `jini:release-check` is the composer's and chat pane's own event (flush the draft, veto during an
 * upload, unresolved send or running reply) and the host's route allowlist. Neither is prevented →
 * the guest's route and scroll come back in the same answer and the guest is unmounted. A guest
 * that throws, rejects or never answers is KEPT: a release is optional, discarding someone's work
 * is not.
 *
 * If every hidden guest vetoes, the shell simply stays over the limit; the next focus change, tab
 * close or limit change tries again. There is no queue, no reservation and no polling.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { liveViewOrder, releaseCandidates, releaseExcessViews, RELEASE_PROBE_TIMEOUT_MS, type ParkedView, type LiveGuest } from './live-views.js';
import type { useSiteViewPreference as UseSiteViewPreference, LiveViewBounds, LiveViewPreferenceBridge } from './use-site-view-preference.js';

interface LiveViewsState {
  /** Live tabs, most recently focused first. */
  readonly order: readonly string[];
  readonly parked: Readonly<Record<string, ParkedView>>;
}

function sameIds({ a, b }: { a: readonly string[]; b: readonly string[] }, _options = {}): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Records a focus change and drops closed tabs, parked routes included; the same state if neither. */
function syncLiveViews({ state, focusedId, openIds }: { state: LiveViewsState; focusedId: string | null; openIds: readonly string[] }, _options = {}): LiveViewsState {
  const order = liveViewOrder({ order: state.order, focusedId, openIds });
  const open = new Set(openIds);
  const stale = Object.keys(state.parked).filter((id) => !open.has(id));
  if (sameIds({ a: order, b: state.order }) && stale.length === 0) return state;
  const parked = Object.fromEntries(Object.entries(state.parked).filter(([id]) => open.has(id)));
  return { order, parked };
}

function applyReleases({ state, released }: { state: LiveViewsState; released: readonly { id: string; parked: ParkedView | null }[] }, _options = {}): LiveViewsState {
  if (released.length === 0) return state;
  const gone = new Set(released.map(({ id }) => id));
  const parked = { ...state.parked };
  // No guest, no route: keep whatever an earlier release recorded rather than forgetting it.
  for (const entry of released) if (entry.parked !== null) parked[entry.id] = entry.parked;
  return { order: state.order.filter((id) => !gone.has(id)), parked };
}

export interface LiveViews {
  /** Whether this tab may mount its guest: the focused tab always may. */
  isLive: (input: { id: string }) => boolean;
  /** Each released tab's last route and scroll, for its next mount. */
  parked: Readonly<Record<string, ParkedView>>;
  /** The guest each tab mounted, so a probe can reach it. Stable across renders. */
  registerGuest: (id: string, node: LiveGuest | null) => void;
}

/**
 * Owns which open tabs keep their guest. `focusedId` is the tab on screen, `null` outside the tabs
 * screen (every tab hidden, the last one focused still the most recent).
 * @param required.useSiteViewPreference the host's binding of the limit-preference hook (`useSiteViewPreference` from this package).
 * @param required.getBridge the host's bridge lookup for the limit preference (stable function).
 * @param required.bounds the limit's range and default (module-level constant).
 * @param required.probe the host's release probe script, run in each hidden guest.
 */
export function useLiveViews({ openIds, focusedId, useSiteViewPreference, getBridge, bounds, probe }: {
  openIds: readonly string[];
  focusedId: string | null;
  useSiteViewPreference: typeof UseSiteViewPreference;
  getBridge: () => LiveViewPreferenceBridge | undefined;
  bounds: LiveViewBounds;
  probe: string;
}, { timeoutMs = RELEASE_PROBE_TIMEOUT_MS }: { timeoutMs?: number } = {}): LiveViews {
  const [state, setState] = useState<LiveViewsState>({ order: [], parked: {} });
  const { value: limit } = useSiteViewPreference({ getBridge, bounds });
  const guests = useRef(new Map<string, LiveGuest>());
  const registerGuest = useCallback((id: string, node: LiveGuest | null) => {
    if (node === null) guests.current.delete(id);
    else guests.current.set(id, node);
  }, []);
  // Keys, not arrays: the site list is a new array on every poll, and that alone is no change.
  const openKey = JSON.stringify(openIds);
  const order = liveViewOrder({ order: state.order, focusedId, openIds });
  const orderKey = JSON.stringify(order);

  useEffect(() => {
    const ids = JSON.parse(openKey) as string[];
    setState((current) => syncLiveViews({ state: current, focusedId, openIds: ids }));
  }, [focusedId, openKey]);

  useEffect(() => {
    // A newer focus, close or limit cancels this pass; its answers would be about a stale order.
    let active = true;
    const { candidates, excess } = releaseCandidates({ order: JSON.parse(orderKey) as string[], focusedId, limit });
    if (excess === 0) return undefined;
    void releaseExcessViews({ candidates, excess, script: probe, guestOf: ({ id }) => guests.current.get(id) ?? null }, { timeoutMs }).then((released) => {
      if (active) setState((current) => applyReleases({ state: current, released }));
    });
    return () => { active = false; };
  }, [orderKey, focusedId, limit, timeoutMs, probe]);

  return { isLive: ({ id }) => order.includes(id), parked: state.parked, registerGuest };
}
