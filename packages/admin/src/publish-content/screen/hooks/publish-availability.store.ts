import { useSyncExternalStore } from "react";

/**
 * @file Whether this admin may publish to a live site at all — the ONE flag every Publish entry
 * point reads: the section buttons (`use-publish-section-button.hooks.ts`), the Dashboard's
 * "Publish all content", and `requestPublish` itself (which covers the `?publish=` deep link, the
 * chat capability and WebMCP, since they all open the dialog through it).
 *
 * `false` only on the live site: the server answers `/auth/me` with `canPublishToLive: false` when
 * the host runs in production mode (the host's live-site publish policy on the server, which also
 * refuses the push routes). The host's admin app hooks feed this store from that response.
 *
 * Defaults to `true`: every screen that shows a Publish button sits behind the sign-in gate, which
 * only opens after `/auth/me` answered, and an older server without the field could publish.
 */

let available = true;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `/auth/me`'s `canPublishToLive`, with an absent field (older server) read as available. */
export function readPublishToLiveAvailability(me: { readonly canPublishToLive?: boolean }): boolean {
  return me.canPublishToLive !== false;
}

export function setPublishToLiveAvailable({ next }: { next: boolean }, _options: Record<string, never> = {}): void {
  if (next === available) return;
  available = next;
  for (const listener of listeners) listener();
}

/** Non-React read, for `requestPublish`. */
export function isPublishToLiveAvailable(): boolean {
  return available;
}

export function usePublishToLiveAvailable(): boolean {
  return useSyncExternalStore(subscribe, isPublishToLiveAvailable, isPublishToLiveAvailable);
}
