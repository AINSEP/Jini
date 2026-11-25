import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import type { MediaErrorMapping } from "./shared.js";

/**
 * @file What the one-row media-provider routes (`patch-provider.ts`, `delete-provider.ts`) share:
 * the path, the provider-id check and the host error deps. Admission is the whole-set PUT's on
 * purpose — same `admin.integrations.manage` permission, same host-bound `workspaceId` — so a
 * caller who may not replace the set cannot reach a single row of it either.
 */

/** Both one-row routes act on this path. */
export const MEDIA_PROVIDER_ROW_PATH = "/api/admin/v1/workspaces/:workspaceId/media/providers/:providerId";

/** The permission every vendor-credential write uses (see `put-providers.ts` for why not `media.write`). */
export const MEDIA_PROVIDER_WRITE_PERMISSION = "admin.integrations.manage";

/** The host error deps both one-row routes read, with the same meaning as the whole-set PUT's. */
export interface MediaProviderRowErrorDeps {
  /** Words a classified host store error for the caller (see {@link OutwardErrorMessage}). */
  outwardErrorMessage: OutwardErrorMessage;
  /** The host's refusals for its own store errors, in order (validation 400, unconfigured store 503). */
  saveErrorMappings: readonly MediaErrorMapping[];
}

/** Longest provider id accepted; ids are catalog slugs, so anything longer is not one. */
const MAX_PROVIDER_ID_LENGTH = 200;
// A control character in an id would only ever be a forged path segment; it never names a provider.
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/** The `:providerId` path segment; Express always fills it, the `?? ""` mirrors the host's own guard. @complexity O(1). */
export function providerIdParam({ params }: { params: Record<string, string | undefined> }, _optional: Record<string, never> = {}): string {
  return String(params.providerId ?? "");
}

/**
 * The provider id when it can name one provider; otherwise a 400 that does not echo it back.
 * Whether the id is in the catalog is the host's question: a saved plugin provider stays removable
 * after its plugin leaves the active catalog.
 * @complexity O(n) in the id length (bounded).
 */
export function requireProviderId({ providerId }: { providerId: string }, _optional: Record<string, never> = {}): string {
  if (providerId.trim() === "" || providerId.length > MAX_PROVIDER_ID_LENGTH || CONTROL_CHARACTER.test(providerId)) {
    return rejectRoute({ status: 400, error: "Choose a media provider.", code: "MEDIA_PROVIDER_ID_INVALID" });
  }
  return providerId;
}
