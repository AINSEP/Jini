import type { MediaProviderMap, MediaProvidersPort } from "../../react/kit-media-providers.js";
import { orFallback } from "@jini-ai/core/errors/idioms";

import type { AdminMediaProviderMap } from "./api/media-api.js";

/**
 * @file The real `MediaProvidersPort` — the host's own implementation of the transport
 * `@jini-ai/ui`'s Media providers tab declares but deliberately does not ship (same convention as
 * `ProjectLocationsPort`/`SkillsPort`; the package ships only a fake).
 *
 * Replaces `createFakeMediaProvidersPort()`, whose in-memory store forgot everything on reload.
 */

/** The two media-API calls the port needs, injected so this file never imports the host client. */
export interface MediaProvidersPortDeps {
  mediaApi: {
    getMediaProviders: () => Promise<AdminMediaProviderMap>;
    saveMediaProviders: (providers: AdminMediaProviderMap) => Promise<AdminMediaProviderMap>;
  };
}

/**
 * Reads the workspace's stored provider credentials.
 *
 * Resolves `null` — never rejects — when the server could not be reached, because that is what the
 * port's contract requires and `mergeDaemonProviders` treats `null` and `{}` very differently:
 * `null` leaves local edits untouched, while `{}` is a real answer that can legitimately drop stale
 * local markers. Collapsing an unreachable server to `{}` would make a transient network blip read
 * as "the server manages nothing" and wipe edits only `null` protects — the exact failure the
 * contract calls out.
 *
 * The catch is therefore intentionally broad: every failure to obtain an answer is "unreachable",
 * including a 500 or a 403. None of them are evidence about what the server manages, which is the
 * only question this method's return value is allowed to assert.
 *
 * @complexity O(1) plus one request.
 * @overallScore 100
 */
async function fetchMediaProviders({ mediaApi }: MediaProvidersPortDeps): Promise<MediaProviderMap | null> {
  return orFallback({ work: () => mediaApi.getMediaProviders(), fallback: null, step: "Read media providers" });
}

/**
 * Persists the whole provider map and resolves the server's authoritative copy.
 *
 * REJECTS on failure, unlike {@link fetchMediaProviders} — the port models a save as having only
 * two outcomes, and the tab renders the rejection as its `save-error` state. Callers must not
 * overlap two of these; `useMediaProvidersTab`'s `persist`/`flushNow` already serializes them.
 *
 * @complexity O(1) plus one request.
 * @overallScore 100
 */
async function saveMediaProviders({ mediaApi }: MediaProvidersPortDeps, providers: MediaProviderMap): Promise<MediaProviderMap> {
  return mediaApi.saveMediaProviders(providers);
}

/** Builds the port over the host's media API; the host binds it once, so every call site shares one object. */
export function createMediaProvidersPort(deps: MediaProvidersPortDeps, _optional: Record<string, never> = {}): MediaProvidersPort {
  return {
    fetchMediaProviders: () => fetchMediaProviders(deps),
    saveMediaProviders: (providers: MediaProviderMap) => saveMediaProviders(deps, providers),
  };
}
