import type { EntityReverter, RevertRegistry } from "@jini-ai/core/contracts/site/core-commands";
import { RevertConflictError, RevertNotPossibleError } from "@jini-ai/cms/core/commands";
import type { PostRepoPort } from "@jini-ai/cms/posts/post";
import { isTrashed } from "@jini-ai/core/contracts/site/soft-delete";

import { PageConcurrentEditError, PageNotFoundError } from "@jini-ai/cms/pages/html-document-store";
import { type PagesHtmlDocumentStoreFactory } from "@jini-ai/core/contracts/site/page-html-store";
import { PAGE_HTML_ENTITY_TYPE, parsePageHtmlInverse } from "./html-inverse.js";


/** Plain recovery words for a restore that lost its compare-and-set to a newer save. */
const RESTORE_CONFLICT_MESSAGE =
  "This page changed after that edit was made, so it was not undone and the newer version was kept. Edit the page again instead.";

/**
 * @file The `page-html/update` reverter (P1-T2.T).
 *
 * Undoing an assistant HTML change writes raw HTML (or a doc body) back onto a Page, which is the
 * `pages.edit_html` authority, not merely the authority to revert an ordinary audited change. So
 * the policy asks the revert executor to check `pages.edit_html` on the same `post` target the
 * writer was checked on, and refuses any operator force: forcing would overwrite a newer human
 * save with raw HTML the forcer may not be allowed to write. The policy is fixed here, never taken
 * from client input or the stored inverse.
 */
export function createPageHtmlReverter(
  { store, postRepo, editPermission }: { editPermission: string; store: PagesHtmlDocumentStoreFactory; postRepo: Pick<PostRepoPort, "findById"> },
  _optional = {},
): EntityReverter {
  return {
    policy: { permission: editPermission, authorizationEntityType: "post", allowForce: false },
    async currentVersion({ workspaceId, entityId }) {
      // Live scoped page only: a trashed or missing row has nothing an Undo may write onto.
      const row = await postRepo.findById({ workspaceId, id: entityId });
      if (!row || isTrashed(row) || row.kind !== "page") return null;
      return row.version;
    },
    async applyInverse({ workspaceId, item }, { actorId } = {}) {
      const inverse = parsePageHtmlInverse({ payload: item.inversePayload });
      if (!inverse || item.entityVersionAtApply === undefined) {
        throw new RevertNotPossibleError("This page change has no restorable earlier version.");
      }
      const scoped = store({ workspaceId, postId: item.entityId, ...(actorId === undefined ? {} : { actorId }) });
      if (!scoped.restore) throw new RevertNotPossibleError("This page store cannot restore an earlier version.");
      try {
        // The CAS stays even after the gateway's version preflight: a save can land in between.
        await scoped.restore({ inverse, expectedVersion: item.entityVersionAtApply });
      } catch (err) {
        if (!(err instanceof PageConcurrentEditError) && !(err instanceof PageNotFoundError)) throw err;
        const row = await postRepo.findById({ workspaceId, id: item.entityId });
        throw new RevertConflictError(RESTORE_CONFLICT_MESSAGE, PAGE_HTML_ENTITY_TYPE, item.entityId, row && !isTrashed(row) ? row.version : null);
      }
    },
  };
}

/**
 * Registers `page-html/update` on the root's one revert registry, bound to the SAME scoped page-store
 * factory the assistant write path uses, so a restore runs through the same kernel, ledger, outbox
 * and reference index as the write it undoes. No second repo, kernel or registry.
 * @complexity O(1).
 */
export function registerPageHtmlReverter(
  { registry, store, postRepo, editPermission }: { editPermission: string; registry: RevertRegistry; store: PagesHtmlDocumentStoreFactory; postRepo: Pick<PostRepoPort, "findById"> },
  _optional = {},
): void {
  registry.register(PAGE_HTML_ENTITY_TYPE, "update", createPageHtmlReverter({ store, postRepo, editPermission }));
}
