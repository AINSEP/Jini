import type { MediaProviderMap } from "../../react/kit-media-providers.js";
import type { MediaProviderFields, MediaProviderRowsPort } from "@jini-ai/ui/core";
import { orFallback } from "@jini-ai/core/errors/idioms";

import type { AdminMediaProviderMap } from "./api/media-api.js";

/**
 * @file The real `MediaProviderRowsPort` — the host's own implementation of the transport
 * `@jini-ai/ui`'s Media providers tab declares but deliberately does not ship (same convention as
 * `ProjectLocationsPort`/`SkillsPort`; the package ships only a fake).
 *
 * Replaces `createFakeMediaProvidersPort()`, whose in-memory store forgot everything on reload.
 */

/** The three media-API calls the port needs, injected so this file never imports the host client.
 *  There is no whole-map save among them: see {@link patchProvider}. */
export interface MediaProvidersPortDeps {
  mediaApi: {
    getMediaProviders: () => Promise<AdminMediaProviderMap>;
    patchMediaProvider: (required: { providerId: string; fields: MediaProviderFields }) => Promise<AdminMediaProviderMap>;
    removeMediaProvider: (required: { providerId: string }) => Promise<AdminMediaProviderMap>;
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
 * Saves ONE provider's fields (PATCH to its own row) and resolves the server's authoritative map.
 *
 * Per-provider rather than a whole-map PUT: a whole map from this tab omits any key
 * another window saved since it loaded, and omission deleted it. Naming one provider can never undo a
 * write to another. REJECTS on failure, unlike {@link fetchMediaProviders} — the tab renders the
 * rejection as its `save-error` state; `useMediaProvidersTab` issues one write at a time.
 *
 * @complexity O(1) plus one request.
 */
async function patchProvider({ mediaApi }: MediaProvidersPortDeps, { providerId, fields }: { providerId: string; fields: MediaProviderFields }): Promise<MediaProviderMap> {
  return mediaApi.patchMediaProvider({ providerId, fields });
}

/**
 * Removes exactly one provider's stored credentials (DELETE on its own row) — including a plugin
 * vendor's key whose plugin is no longer in the catalog — and resolves the authoritative map.
 * Rejects on failure, like {@link patchProvider}.
 *
 * @complexity O(1) plus one request.
 */
async function removeProvider({ mediaApi }: MediaProvidersPortDeps, { providerId }: { providerId: string }): Promise<MediaProviderMap> {
  return mediaApi.removeMediaProvider({ providerId });
}

/** Builds the port over the host's media API; the host binds it once, so every call site shares one object. */
export function createMediaProvidersPort(deps: MediaProvidersPortDeps, _optional: Record<string, never> = {}): MediaProviderRowsPort {
  return {
    fetchMediaProviders: () => fetchMediaProviders(deps),
    patchProvider: (required: { providerId: string; fields: MediaProviderFields }) => patchProvider(deps, required),
    removeProvider: (required: { providerId: string }) => removeProvider(deps, required),
  };
}
