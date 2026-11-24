import { useSyncExternalStore } from "react";

/**
 * @file Whether this admin may publish to a live site at all — the ONE flag every Publish entry
 * point reads: the section buttons (`use-publish-section-button.hooks.ts`), the Dashboard's
 * "Publish all content", and `requestPublish` itself (which covers the `?publish=` deep link, the
 * chat capability and WebMCP, since they all open the dialog through it).
 *
 * `false` only on the live site: the server answers `/auth/me` with `canPublishToLive: false` when
 * the host runs in its production runtime mode (the host server's live-site publish policy, which
 * also refuses the push routes). The host admin app's session boot feeds this store from that
 * response via `setPublishToLiveAvailable`.
 *
 * State is instance-owned: the host creates ONE store with `createPublishToLiveAvailabilityStore`
 * and every Publish entry point reads that instance, so two hosts (or two tests) never share a flag.
 *
 * Defaults to `true`: every screen that shows a Publish button sits behind the sign-in gate, which
 * only opens after `/auth/me` answered, and an older server without the field could publish.
 */

/** `/auth/me`'s `canPublishToLive`, with an absent field (older server) read as available. */
export function readPublishToLiveAvailability(me: { readonly canPublishToLive?: boolean }): boolean {
  return me.canPublishToLive !== false;
}

export interface PublishToLiveAvailabilityStore {
  setPublishToLiveAvailable(required: { next: boolean }, _options?: Record<string, never>): void;
  /** Non-React read, for the host's publish-request entry point. */
  isPublishToLiveAvailable(): boolean;
  usePublishToLiveAvailable(): boolean;
}

export function createPublishToLiveAvailabilityStore(
  _required: Record<string, never> = {},
  _options: Record<string, never> = {},
): PublishToLiveAvailabilityStore {
  let available = true;
  const listeners = new Set<() => void>();

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function isPublishToLiveAvailable(): boolean {
    return available;
  }

  return {
    setPublishToLiveAvailable({ next }, _setOptions = {}) {
      if (next === available) return;
      available = next;
      for (const listener of listeners) listener();
    },
    isPublishToLiveAvailable,
    usePublishToLiveAvailable() {
      return useSyncExternalStore(subscribe, isPublishToLiveAvailable, isPublishToLiveAvailable);
    },
  };
}
