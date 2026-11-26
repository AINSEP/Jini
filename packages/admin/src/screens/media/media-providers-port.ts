import type { MediaProviderEditPatch as MediaProviderFields, MediaProviderMap, MediaProviderRowsPort } from "../../react/kit-media-providers.js";
import type { MediaProviderOption } from "@jini-ai/core";
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
    applyMediaProviderChanges: (required: { removes: readonly string[]; patches: readonly { providerId: string; fields: MediaProviderFields }[] }) => Promise<AdminMediaProviderMap>;
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
    applyProviderChanges: (required, _optional = {}) => deps.mediaApi.applyMediaProviderChanges(required),
    patchProvider: (required: { providerId: string; fields: MediaProviderFields }) => patchProvider(deps, required),
    removeProvider: (required: { providerId: string }) => removeProvider(deps, required),
  };
}

/** The read seam the External Providers tab takes its cards (and its count) from. */
export interface MediaProviderCatalogPort {
  fetchMediaProviderCatalog(_required?: Record<string, never>): Promise<readonly MediaProviderOption[] | null>;
}

/** The one media-API call the catalog port needs, injected so this file never imports the host client. */
export interface MediaProviderCatalogPortDeps {
  mediaApi: { getMediaProviderCatalog: () => Promise<{ providers?: unknown } | null | undefined> };
}

/** A card only when its id and label are strings; anything else in the body is dropped, not trusted. @complexity O(1). */
function isProviderOption(value: unknown): value is MediaProviderOption {
  const candidate = value as Partial<MediaProviderOption> | null;
  return typeof candidate?.id === "string" && typeof candidate.label === "string";
}

/**
 * Reads the host's live provider catalog. Resolves `null` — never rejects, never `[]` — when the
 * server could not be reached or answered something that is not a catalog, for the same reason as
 * {@link fetchMediaProviders}: an unreachable host is not evidence that no provider exists, and a
 * `[]` would render as "no providers" with a count of 0.
 *
 * @complexity O(p) over the returned cards plus one request.
 */
async function fetchMediaProviderCatalog({ mediaApi }: MediaProviderCatalogPortDeps, _required: Record<string, never> = {}): Promise<readonly MediaProviderOption[] | null> {
  const body = await orFallback({ work: () => mediaApi.getMediaProviderCatalog(), fallback: null, step: "Read media provider catalog" });
  const providers: unknown = body?.providers;
  return Array.isArray(providers) ? providers.filter(isProviderOption) : null;
}

/** Builds the catalog port over the host's media API; the host binds it once. */
export function createMediaProviderCatalogPort(deps: MediaProviderCatalogPortDeps, _optional: Record<string, never> = {}): MediaProviderCatalogPort {
  return { fetchMediaProviderCatalog: () => fetchMediaProviderCatalog(deps) };
}
