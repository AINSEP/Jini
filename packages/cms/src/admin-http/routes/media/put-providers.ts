import { defineJsonRoute, ok, type RouteReply } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import type { AdminMediaProviderMarkers } from "@jini-ai/core/contracts/site/cms-media";

import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import { MEDIA_PROVIDERS_REVISION_REQUEST_HEADER, mediaProvidersReply, type MediaProvidersReadModel } from "./get-providers.js";
import { authorizeMedia, rejectMediaError, type MediaErrorMapping, type MediaRoutePrincipal } from "./shared.js";

/** What a whole-set save answers: the new read model, or `stale` when the store's revision no longer matches. */
export type MediaProvidersSaveOutcome = ({ outcome: "saved" } & MediaProvidersReadModel) | { outcome: "stale" };

/**
 * Replaces the workspace's whole credential set and answers the same markers-only read model GET
 * returns. The host compares `expectedRevision` with its stored revision INSIDE the same writer
 * boundary as the write and answers `stale` without writing on a mismatch; a compare made before
 * that boundary would let a newer write land between the check and this one. Injected: the secret
 * store is the host's.
 */
export type MediaProvidersSaveFn = (required: { workspaceId: string; providers: Record<string, unknown>; expectedRevision: string }) => Promise<MediaProvidersSaveOutcome>;

/** The caller copy for a missing or stale last-read revision. */
export const MEDIA_PROVIDERS_STALE_MESSAGE = "Your provider list changed in another window. Reload and try again.";
/** The refusal code beside {@link MEDIA_PROVIDERS_STALE_MESSAGE}. */
export const MEDIA_PROVIDERS_STALE_CODE = "MEDIA_PROVIDERS_STALE";

/** One strong entity tag, `"<revision>"`; a weak tag, `*` or a list is no basis for a whole-set replace. */
const STRONG_SINGLE_TAG = /^"([^"]+)"$/;

/** The last-read revision from `If-Match`, or `undefined` when there is no usable one. @complexity O(n) in the header length. */
function expectedRevisionOf({ headers }: { headers: Readonly<Record<string, string>> | undefined }, _optional: Record<string, never> = {}): string | undefined {
  return STRONG_SINGLE_TAG.exec(headers?.[MEDIA_PROVIDERS_REVISION_REQUEST_HEADER]?.trim() ?? "")?.[1];
}

/** Refuses a missing or stale basis with the 409 the tab words as "reload and try again". @complexity O(1). */
function rejectStaleProviders(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): never {
  return rejectRoute({ status: 409, error: MEDIA_PROVIDERS_STALE_MESSAGE, code: MEDIA_PROVIDERS_STALE_CODE });
}

/** The deps this route reads. */
export interface MediaPutProvidersRouteDeps {
  workspaceId: string;
  saveProviders: MediaProvidersSaveFn;
  /** Words a classified host store error for the caller (see {@link OutwardErrorMessage}); a mapping with its own fixed `error` copy keeps it. */
  outwardErrorMessage: OutwardErrorMessage;
  /** The host's refusals for its own store errors, in order (validation 400, unconfigured store 503 with the
   *  host's operator copy). The error classes and that copy are the host's, so the table is too. */
  saveErrorMappings: readonly MediaErrorMapping[];
}

/**
 * PUT the workspace's media-generation vendor credentials as a WHOLE SET. Answers
 * `MediaProvidersPort.saveMediaProviders` in `@jini-ai/ui`.
 *
 * Body is the provider map itself (`{ "openai": { apiKey?, baseUrl?, model? }, … }`), not a wrapped
 * envelope — matching the port's signature. A provider absent from the body is DELETED: the tab
 * sends its entire local map and expresses a cleared credential as an omission, so treating absence
 * as "leave alone" would make Clear silently do nothing.
 *
 * Gated by `admin.integrations.manage`, the same permission every other vendor-credential route in
 * this codebase uses (connectors, commerce, external-mcp, and the webhook-subscription routes in
 * `015-integrations.yaml`) — not `media.write`, which is deprecated and no longer granted to fresh
 * admin roles, so it would silently lock new admins out of a feature legacy admins can still reach.
 *
 * The response never echoes key material — it is the same markers-only map GET returns. Three
 * failure outcomes, mirroring `put-site-credential.ts`'s split: 400 validation (unknown provider
 * id, wrong field type, oversized field), 503 `SECRET_STORE_UNCONFIGURED` (missing
 * site key, detected before any write lands), 500 everything else.
 *
 * Because a whole set replaces everything, it must be based on what the sender last read: the PUT
 * carries GET's ETag back in `If-Match` (mount with `readHeaders: ["if-match"]`). A missing or stale
 * basis is a 409 with no write — otherwise a tab opened earlier would delete a key another window
 * saved since, purely because its older map omits it. New callers should use the one-row PATCH and
 * DELETE routes, which never infer deletion from omission.
 */
export const mediaPutProvidersRoute = defineJsonRoute<{ providers: Record<string, unknown>; expectedRevision?: string }, RouteReply<AdminMediaProviderMarkers>, MediaPutProvidersRouteDeps, MediaRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/media/providers",
  parse: (raw) => {
    const expectedRevision = expectedRevisionOf({ headers: raw.headers });
    return ok({ value: { providers: (raw.body ?? {}) as Record<string, unknown>, ...(expectedRevision === undefined ? {} : { expectedRevision }) } });
  },
  handle: async ({ input, deps, authorize }) => {
    await authorizeMedia({ authorize, permission: "admin.integrations.manage" });
    if (input.expectedRevision === undefined) return rejectStaleProviders();
    let saved: MediaProvidersSaveOutcome;
    try {
      saved = await deps.saveProviders({ workspaceId: deps.workspaceId, providers: input.providers, expectedRevision: input.expectedRevision });
    } catch (err) {
      return rejectMediaError({ err, mappings: deps.saveErrorMappings, outwardErrorMessage: deps.outwardErrorMessage });
    }
    if (saved.outcome === "stale") return rejectStaleProviders();
    return ok({ value: mediaProvidersReply({ model: saved }) });
  },
});
