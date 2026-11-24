import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  handleContentCreate, idempotencyKeyOf, type ContentCreateDeps, type ContentCreateInput, type ContentWriteRoutePrincipal,
} from "./shared.js";

/** The deps this route reads: the gateway's collaborators, the host's `createPost` binding, serializer, drain and error tests. */
export type PostCreateRouteDeps = ContentCreateDeps;

/**
 * POST a new post — routed through the command gateway (mirrors the update route so post mutations
 * stay consistently auditable/revertible). The gateway authorizes `content.write` for the real
 * authenticated principal (SPEC-006 REQ-05).
 *
 * SPEC-002 api.spec.md `POST_CREATE` §4 — `slug`/`bodyJson`/`status` are optional body fields; the
 * host's `createEntry` forwards each only when present so the service's default-when-absent applies.
 * A post created directly as `status: "published"` enqueues `entry.published`, drained before the
 * response. Reads `Idempotency-Key` (mount it with `readHeaders: ["idempotency-key"]`); a replay is
 * 409 `DUPLICATE_COMMAND`. The 1 MiB body cap is the host's own binding in front of the mount (its
 * 413 copy is not the kit's `maxBodyBytes` refusal).
 */
export const postCreateRoute = defineJsonRoute<ContentCreateInput, object, PostCreateRouteDeps, ContentWriteRoutePrincipal>(
  {
    method: "post",
    path: "/api/admin/v1/workspaces/:workspaceId/posts",
    parse: (raw) => ok({ value: { body: raw.body, idempotencyKey: idempotencyKeyOf({ headers: raw.headers }) } }),
    handle: ({ input, deps, context }) => handleContentCreate({ input, deps, context }, { summary: "Create post", family: "posts" }),
  },
  { successStatus: 201 },
);
