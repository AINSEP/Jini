import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { Clock } from "@jini-ai/core/primitives";

import type { KernelOutboxAdapterDeps } from "../../../core/kernel-outbox.js";
import { adaptLegacyAuthorize } from "../../../core/tools/index.js";
import { toContentTypeOutbox, type ContentTypeRepoPort, type IndexProvisionerPort } from "../../../content-types/index.js";

/**
 * @file The content-type write routes' own deps (register, update-fields, lifecycle). The request
 * helpers both route families share live in `collections-route.ts`.
 */

/** The deps every content-type write route reads (register, update-fields, lifecycle). */
export interface ContentTypeWriteRouteDeps {
  workspaceId: string;
  /** The host's RBAC evaluator; the write services re-check the same permission through it. */
  authorize: AuthorizeFn;
  clock: Clock;
  idGen: KernelOutboxAdapterDeps["idGen"];
  outbox: KernelOutboxAdapterDeps["outbox"];
  contentTypeRepo: ContentTypeRepoPort;
  contentTypeIndexProvisioner: IndexProvisionerPort;
}

/** The content-type write-service deps built from the route deps.
 * @complexity O(1). */
export function contentTypeWriteDeps({ deps }: { deps: ContentTypeWriteRouteDeps }, _optional: Record<string, never> = {}) {
  return {
    repo: deps.contentTypeRepo,
    clock: deps.clock,
    ids: deps.idGen,
    // Jini passes entity scope separately; merge it into the host evaluator's request.
    authorize: adaptLegacyAuthorize({ authorize: deps.authorize }),
    indexProvisioner: deps.contentTypeIndexProvisioner,
    outbox: toContentTypeOutbox(deps),
  };
}
