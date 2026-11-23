import { dropInFlightSettingsReads } from "./settings-effective-reads.js";

/**
 * @file The seam between "a setting changed somewhere else" and "the mounted settings tabs re-read
 * it", so an operator sees a change they did not make in this component without reloading the page.
 *
 * ## Why a bus rather than props
 *
 * Two unrelated publishers need to reach the same subscribers, and neither is anywhere near them in
 * the tree:
 *
 * 1. `components/AssistantDock/AssistantDock.tsx` — an assistant run finished, and it may have called
 *    `settings_set_ui_preference`. The dock and `features/settings/SettingsUi.tsx` are siblings under
 *    `App.tsx` with no shared state between them.
 * 2. `lib/settings-events.ts` — the server pushed a change over SSE, which is how a write made in
 *    ANOTHER tab, by another operator, or by a background process arrives.
 *
 * Threading a callback from `App.tsx` through both subtrees would couple the assistant dock and the
 * transport layer to the settings panel's internals for what is, in both cases, a fire-and-forget
 * notification carrying no data.
 *
 * ## What it deliberately does NOT carry
 *
 * Only namespace names — never values. A subscriber re-reads through the normal authorized
 * `getSettingsEffective` path, so the bus can never become a channel that hands a component a value
 * it would not have been allowed to fetch. That property is what lets the SSE publisher stay
 * simple: it never has to reason about whether a payload is safe for this principal, because there
 * is no payload.
 */

/**
 * A refresh notification. `null` means "something changed, but which namespaces is not known" —
 * every subscriber should re-read. Publishers that DO know narrow it, so an unrelated tab does not
 * refetch.
 */
export type SettingsRefreshScope = readonly string[] | null;

type Listener = (scope: SettingsRefreshScope) => void;

const listeners = new Set<Listener>();

/**
 * Registers `listener` and returns its unsubscribe function.
 *
 * @returns A disposer; call it from the subscriber's effect cleanup. A listener that outlives its
 * component would set state on an unmounted one.
 * @complexity O(1).
 */
export function subscribeToSettingsRefresh(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Notifies every subscriber that persisted settings may have moved.
 *
 * Never throws: a listener that throws is logged and the remaining listeners still run. Publishers
 * are transport/lifecycle code (an SSE frame, a run ending) with no sensible way to handle one
 * settings tab's failure, and one broken subscriber must not suppress the rest.
 *
 * @param namespaces - The namespaces known to have changed, or omitted for "unknown, refresh all".
 * @complexity O(n) in the listener count.
 */
export function publishSettingsRefresh(namespaces?: readonly string[]): void {
  const scope: SettingsRefreshScope = namespaces && namespaces.length > 0 ? namespaces : null;
  dropInFlightSettingsReads({ namespaces: scope }, {});
  for (const listener of [...listeners]) {
    try {
      listener(scope);
    } catch (error) {
      console.error("[admin] settings refresh listener failed", error);
    }
  }
}

/** Test seam — drops every listener. Not used in production code. */
export function resetSettingsRefreshBus(): void {
  listeners.clear();
}
