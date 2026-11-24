import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  handleContentCreate, idempotencyKeyOf, type ContentCreateDeps, type ContentCreateInput, type ContentWriteRoutePrincipal,
} from "../posts/shared.js";

/** The deps this route reads: the gateway's collaborators, the host's page-kind `createPost` binding, serializer, drain and error tests. */
export type PageCreateRouteDeps = ContentCreateDeps;

/**
 * POST a new Page — a `posts` row of kind `page`, created through the command gateway exactly like
 * a post (`content.write`, `Idempotency-Key` via `readHeaders: ["idempotency-key"]`, inline outbox
 * drain, 201 with the serialized row). The 1 MiB cap is the host's binding in front of the mount.
 */
export const pageCreateRoute = defineJsonRoute<ContentCreateInput, object, PageCreateRouteDeps, ContentWriteRoutePrincipal>(
  {
    method: "post",
    path: "/api/admin/v1/workspaces/:workspaceId/pages",
    parse: (raw) => ok({ value: { body: raw.body, idempotencyKey: idempotencyKeyOf({ headers: raw.headers }) } }),
    handle: ({ input, deps, context }) => handleContentCreate({ input, deps, context }, { summary: "Create page", family: "pages" }),
  },
  { successStatus: 201 },
);
