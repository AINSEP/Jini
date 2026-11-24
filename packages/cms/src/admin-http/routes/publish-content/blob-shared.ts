import type { JsonRouteAuthorize, RouteInputContext } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { isValidSha256Hex } from "../../../publish/transfer/blob-staging.js";

/**
 * @file The two guards the publish-content blob routes (`blob-get.ts`, `blob-put.ts`) and the
 * export route share: the `:sha` path-segment check (a 400 answered before the session is read, so
 * those mounts opt into `deferMissingPrincipal`) and the id-free `publish_content.*` permission ask.
 */

/** The `:sha` path segment, refused with the flat 400 unless it is a lowercase 64-hex sha256 digest. @complexity O(1). */
export function blobShaParam({ params }: { params: RouteInputContext["params"] }, _optional: Record<string, never> = {}): string {
  const sha256 = String(params.sha ?? "");
  if (!isValidSha256Hex({ value: sha256 })) rejectRoute({ status: 400, error: "sha must be a lowercase 64-character hex sha256 digest" });
  return sha256;
}

/**
 * Asks the host for one `publish_content.*` permission with no entity type and no entity scope —
 * exactly the params the hand-written `authorizeOrRespond` call sent. A mount without an authorizer
 * is a wiring bug, so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizePublishContentPermission(
  { authorize, permission }: { authorize: JsonRouteAuthorize | undefined; permission: string },
  _optional: Record<string, never> = {},
): Promise<void> {
  if (!authorize) throw new Error("publish-content admin route has no authorizer");
  await authorize({ permission });
}
