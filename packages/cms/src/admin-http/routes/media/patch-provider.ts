import { defineJsonRoute, ok, type RouteReply } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import type { AdminMediaProviderMarkers } from "@jini-ai/core/contracts/site/cms-media";

import { mediaProvidersReply, type MediaProvidersReadModel } from "./get-providers.js";
import { MEDIA_PROVIDER_ROW_PATH, MEDIA_PROVIDER_WRITE_PERMISSION, providerIdParam, requireProviderId, type MediaProviderRowErrorDeps } from "./provider-row.js";
import { authorizeMedia, rejectMediaError, type MediaRoutePrincipal } from "./shared.js";

/** The operator-editable fields of ONE provider. An omitted `apiKey` keeps the stored key. */
export interface MediaProviderFieldsInput {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * Merges `fields` into one provider's stored credentials and answers the redacted read model. The
 * host validates and seals before its write and merges against current rows inside its writer
 * boundary; no other provider is touched. Injected: the secret store is the host's.
 */
export type MediaProviderPatchFn = (
  required: { workspaceId: string; providerId: string; fields: MediaProviderFieldsInput },
  optional?: Record<string, never>,
) => Promise<MediaProvidersReadModel>;

/** The deps this route reads. */
export interface MediaPatchProviderRouteDeps extends MediaProviderRowErrorDeps {
  workspaceId: string;
  patchProvider: MediaProviderPatchFn;
}

const FIELD_NAMES: ReadonlySet<string> = new Set(["apiKey", "baseUrl", "model"]);
const FIELDS_INVALID = { status: 400, error: "Send the settings for one provider only: its API key, base URL or model, each as text.", code: "MEDIA_PROVIDER_FIELDS_INVALID" } as const;

/**
 * The body as one provider's fields, or a 400 that echoes none of it. Only the three editable
 * fields, each a string: a provider map (`{ "<id>": { … } }`) or a nested value is refused rather
 * than read, so this route can never become a second whole-set write.
 * @complexity O(k) in the body's key count.
 */
function requireProviderFields({ body }: { body: unknown }, _optional: Record<string, never> = {}): MediaProviderFieldsInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return rejectRoute(FIELDS_INVALID);
  const fields: MediaProviderFieldsInput = {};
  for (const [name, value] of Object.entries(body)) {
    if (!FIELD_NAMES.has(name) || typeof value !== "string") return rejectRoute(FIELDS_INVALID);
    fields[name as keyof MediaProviderFieldsInput] = value;
  }
  return fields;
}

/**
 * PATCH one media-generation vendor's credentials. Answers `MediaProviderRowsPort.patchProvider` in
 * `@jini-ai/ui`. Same admission as the whole-set PUT; authorization runs before the body is read,
 * so an unauthorized caller learns nothing about what a valid body looks like. The answer is the
 * same markers-only map GET returns, with its new revision as the `ETag`.
 */
export const mediaPatchProviderRoute = defineJsonRoute<{ providerId: string; body: unknown }, RouteReply<AdminMediaProviderMarkers>, MediaPatchProviderRouteDeps, MediaRoutePrincipal>({
  method: "patch",
  path: MEDIA_PROVIDER_ROW_PATH,
  parse: (raw) => ok({ value: { providerId: providerIdParam({ params: raw.params }), body: raw.body } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeMedia({ authorize, permission: MEDIA_PROVIDER_WRITE_PERMISSION });
    const providerId = requireProviderId({ providerId: input.providerId });
    const fields = requireProviderFields({ body: input.body });
    try {
      return ok({ value: mediaProvidersReply({ model: await deps.patchProvider({ workspaceId: deps.workspaceId, providerId, fields }) }) });
    } catch (err) {
      return rejectMediaError({ err, mappings: deps.saveErrorMappings, outwardErrorMessage: deps.outwardErrorMessage });
    }
  },
});
