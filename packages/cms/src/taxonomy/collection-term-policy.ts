import { ForbiddenError } from "../core/commands/command.js";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import {
  createContentLookup,
  type ContentRecordLookupPort,
  type EntryRecordLookupPort,
} from "./content-lookup.js";
import { isContentTypeOnAllowList } from "./assignment-service.js";
import type { ContentLookupPort, ContentTypeTaxonomyPolicyPort } from "./write-contracts.js";

/**
 * @file Which content Jini's `assignTerms`/`unassignTerms` may tag, and who may tag it. They only
 * resolve a non-post/page `contentType` through a `contentTypeTaxonomyPolicy`. Shared by the admin
 * assignment routes (`routes/taxonomy/assign-terms.ts`), the assistant's tagging tools
 * (`tool-registrations.ts`) and the publish ports (`composition/content-publish-ports.ts`), so an
 * entry the editor can tag is an entry the assistant and publishing can tag, and the other way round.
 */

/** The one content-type read the policy needs. */
export interface CollectionOwnerLookupPort {
  findByKey(params: { workspaceId: string; key: string }): Promise<{ readonly status: string } | null>;
}

/**
 * Any taxonomy on an entry whose collection exists here and is not tombstoned: nothing narrower is
 * recorded per collection to check against.
 * @complexity one indexed read per call.
 */
export function createLiveCollectionTermPolicy(deps: {
  contentTypeRepo: CollectionOwnerLookupPort; workspaceId: string;
  /** Host-owned exclusions can include widget entries, which never carry terms. */
  excludedTypes: ReadonlySet<string>;
}, _optional = {}): ContentTypeTaxonomyPolicyPort {
  return {
    async taxonomiesFor({ contentType }) {
      if (deps.excludedTypes.has(contentType)) return null;
      const owner = await deps.contentTypeRepo.findByKey({ workspaceId: deps.workspaceId, key: contentType });
      return owner && owner.status !== "tombstone" ? "all" : null;
    },
  };
}

/**
 * `assignTerms`'s content lookup and entry policy: posts/pages and entries of a live collection
 * both resolve.
 * @complexity O(1) — builds two adapters, no I/O.
 */
export function createContentTargetPorts(deps: {
  postRepo: ContentRecordLookupPort;
  entryRepo: EntryRecordLookupPort;
  contentTypeRepo: CollectionOwnerLookupPort;
  workspaceId: string;
  excludedTypes: ReadonlySet<string>;
}, _optional = {}): { contentLookup: ContentLookupPort; contentTypeTaxonomyPolicy: ContentTypeTaxonomyPolicyPort } {
  return {
    contentLookup: createContentLookup({ postRepo: deps.postRepo, entryRepo: deps.entryRepo, workspaceId: deps.workspaceId }),
    contentTypeTaxonomyPolicy: createLiveCollectionTermPolicy(deps),
  };
}

/** The host permission the content type's own editor saves under, split between post/page and collection entries. */
export function contentEditPermission({ contentType, postPermission, collectionPermission }: {
  contentType: string; postPermission: string; collectionPermission: string;
}, _optional = {}): string {
  return isContentTypeOnAllowList({ contentType }) ? postPermission : collectionPermission;
}

/**
 * Throws `ForbiddenError` unless the caller may edit `contentType`'s content — tagging needs this on
 * top of `admin.taxonomy.manage`, which Jini checks for the write itself.
 * @complexity one `authorize()` call.
 */
export async function authorizeContentEdit(deps: {
  authorize: AuthorizeFn; workspaceId: string; principalId: string; contentType: string;
  postPermission: string; collectionPermission: string;
}, _optional = {}): Promise<void> {
  const { principalId, contentType, postPermission, collectionPermission } = deps;
  const permission = contentEditPermission({ contentType, postPermission, collectionPermission });
  const result = await deps.authorize({ principalId, permission, workspaceId: deps.workspaceId });
  if (!result.allowed) {
    throw new ForbiddenError({ message: `principal '${principalId}' is not authorized for '${permission}' (${result.reason})`, permission, reason: result.reason });
  }
}
