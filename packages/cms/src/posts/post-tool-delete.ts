import { isTrashed } from "@jini-ai/core/contracts/site/soft-delete";
import { ToolInputError } from "@jini-ai/core";
import type { PublicPostKind } from "@jini-ai/cms/core";
import { isPublicPost, PostNotFoundError, type PostRecord, type PublicPostRecord } from "@jini-ai/cms/posts/post";
import type { PostKind } from "@jini-ai/core/contracts/site/post-kind";
import type { PostToolDeps } from "./post-tool-deps.js";

/**
 * Reads the row `content_post_delete` is about to gate on, applying the same not-found rules
 * `content_post_get` uses (kind mismatch and trashed rows both read as not-found — a second delete
 * cannot "succeed"). Throws `PostNotFoundError` rather than returning `null` because there is no
 * valid "keep going" path once this fails.
 * @param required - Workspace-bound dependencies and the target id; call only after read authorization.
 * @param optional - Requested public kind, if supplied; omitted kind is derived from the returned row.
 * @returns The live public post/page; internal templates are not content-tool targets.
 * @throws {PostNotFoundError} For missing, internal, trashed or page-kind-mismatched rows.
 * @complexity O(1) repository reads and auxiliary space.
 */
export async function loadDeletablePost(
  { routeDeps, id }: { routeDeps: PostToolDeps; id: string },
  { kind }: { kind?: PublicPostKind } = {},
): Promise<PublicPostRecord> {
  const existing = await routeDeps.postRepo.findById({ workspaceId: routeDeps.workspaceId, id });
  if (!isPublicPost(existing) || isTrashed(existing) || (kind === "page" && existing.kind !== "page")) {
    throw new PostNotFoundError(`${kind ?? "post"} '${id}' was not found`);
  }
  return existing;
}

/**
 * Refuses to write if the row moved between read and removal. See the caller's own
 * inline history: this replaces the former token-bound version check (ADR-055
 * Decision 3 removed the token, not the need for the check).
 */
export function assertFreshVersion({ current, existing, kind }: { current: PostRecord | null; existing: PostRecord; kind: PostKind }, _optional: Record<string, never> = {}): void {
  if (current && !isTrashed(current) && current.version !== existing.version) {
    // A `ToolInputError`, not a bare `Error`: that marker is the only thing keeping this out of the
    // `errorKind: 'internal'` bucket the delegated-tool transport SEC-005-redacts, and a model told
    // only "500" here cannot learn that nothing was deleted or that calling again fixes it. The code
    // goes in FRONT of the original wording, which is otherwise unchanged character for character —
    // `__tests__/agent-tools.delete-confirmation.test.ts` matches on `/stale-entity-version/`.
    throw new ToolInputError({ message: `CONTENT_POST_STALE_CONFIRMATION: content_post_delete: the removal could not be completed ` +
        `(stale-entity-version). The ${kind} changed between its read and removal. ` +
        `Nothing was deleted. Call content_post_delete again with { id, kind } to raise a fresh ` +
        `dialog against the current version.` });
  }
  // A missing or already-trashed `current` is not handled specially here: `deletePost` performs its
  // own fresh existence/trashed check and throws `PostNotFoundError`, the same outcome this handler
  // already produces for that case above.
}
