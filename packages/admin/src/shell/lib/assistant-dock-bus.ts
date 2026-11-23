import { reportShellFailure } from "./shell-failure-log.js";
/**
 * @file The seam between "some section wants the assistant dock open" and `App.tsx`, which actually
 * owns that boolean.
 *
 * ## Why a bus rather than props
 *
 * Same reason as `settings-refresh-bus.ts`, and deliberately the same shape so there is one idiom in
 * this app rather than two. `chatOpen` lives in `App.tsx`, but sections are rendered through
 * `renderRoute(route)` — a plain function that takes a route and returns a node, with no props bag
 * to thread anything through. Giving it one solely so a single checkbox could reach `setChatOpen`
 * would put an assistant-specific parameter on the path of every unrelated section.
 *
 * ## Why this one carries state, when the settings bus does not
 *
 * `settings-refresh-bus` is fire-and-forget: subscribers re-read through their own authorized path,
 * so it can stay payload-free. Here the subscriber is a **checkbox that must show whether the dock
 * is currently open**, including when the operator opened it with the FAB instead. A signal with no
 * state would leave that control lying about the thing it claims to represent the moment the dock
 * was toggled anywhere else.
 *
 * `App.tsx` remains the owner: it publishes its state here on every change, and it listens for
 * requests. This module never opens anything itself — it only carries the ask and the answer, which
 * keeps `chatOpen`'s effects (focus handling, escape-to-close, sheet sizing) in the one place that
 * can honor them.
 *
 * The `subscribe` + `getSnapshot` pair is shaped for `useSyncExternalStore`, so a consumer gets a
 * tear-free read without this module knowing anything about React.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let dockOpen = false;

/** Requests to change the dock, published by `App.tsx` (the owner) and consumed here. */
type RequestListener = (open: boolean) => void;
const requestListeners = new Set<RequestListener>();

/**
 * Subscribes to changes in the dock's open state.
 *
 * @returns A disposer; call it from the subscriber's effect cleanup.
 * @complexity O(1).
 */
export function subscribeToAssistantDock(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The dock's current open state.
 *
 * Returns a primitive rather than an object on purpose: `useSyncExternalStore` compares snapshots by
 * identity, and a fresh object each call would re-render on every store read forever.
 *
 * @complexity O(1).
 */
export function getAssistantDockOpen(): boolean {
  return dockOpen;
}

/**
 * Records the dock's state and notifies subscribers. **Only `App.tsx` should call this** — it is the
 * component that owns `chatOpen`, and a second publisher would let this module disagree with the
 * thing it is supposed to mirror.
 *
 * No-ops when the value is unchanged, so React's effect running on every render cannot turn into a
 * notification storm.
 *
 * @complexity O(n) in the subscriber count, O(1) when unchanged.
 */
export function publishAssistantDockState({ open }: { open: boolean }, _optional: Record<string, never> = {}): void {
  if (open === dockOpen) return;
  dockOpen = open;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      reportShellFailure({ message: "[admin] assistant dock listener failed", error });
    }
  }
}

/**
 * Registers the handler that actually opens or closes the dock. `App.tsx` calls this once.
 *
 * @returns A disposer; call it from the owner's effect cleanup.
 * @complexity O(1).
 */
export function subscribeToAssistantDockRequests({ listener }: { listener: RequestListener }, _optional: Record<string, never> = {}): () => void {
  requestListeners.add(listener);
  return () => {
    requestListeners.delete(listener);
  };
}

/**
 * Asks for the dock to be opened or closed. Safe to call when nothing is listening — that is the
 * case in a unit test rendering a section on its own, and a section asking for a dock that is not
 * mounted is a no-op rather than an error.
 *
 * Never throws, for the same reason `publishSettingsRefresh` does not: one failing handler must not
 * take out the caller, which is ordinary UI event code with nowhere sensible to put the failure.
 *
 * @complexity O(n) in the handler count.
 */
export function requestAssistantDock({ open }: { open: boolean }, _optional: Record<string, never> = {}): void {
  for (const listener of [...requestListeners]) {
    try {
      listener(open);
    } catch (error) {
      reportShellFailure({ message: "[admin] assistant dock request handler failed", error });
    }
  }
}

/** Test seam — drops every listener and resets the state. Not used in production code. */
export function resetAssistantDockBus(): void {
  listeners.clear();
  requestListeners.clear();
  dockOpen = false;
}
