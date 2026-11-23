import { type AuthorizeFn } from "@jini-ai/core/contracts/events";
import {
  type ContentRecordLookupPort,
  type EntryRecordLookupPort,
} from "../content-lookup.js";
import {
  createLiveCollectionTermPolicy as createJiniLiveCollectionTermPolicy,
  createContentTargetPorts as createJiniContentTargetPorts,
  contentEditPermission as jiniContentEditPermission,
  authorizeContentEdit as authorizeJiniContentEdit,
  type CollectionOwnerLookupPort,
} from "../collection-term-policy.js";
import { type ContentLookupPort, type ContentTypeTaxonomyPolicyPort } from "../write-contracts.js";

/**
 * @file Which content Jini's `assignTerms`/`unassignTerms` may tag, and who may tag it. They only
 * resolve a non-post/page `contentType` through a `contentTypeTaxonomyPolicy`. Shared by the host's admin
 * term-assignment routes, the assistant's tagging tools and the content publish ports, so an
 * entry the editor can tag is an entry the assistant and publishing can tag, and the other way round.
 */

/** Widget types are entries too, but never carry terms. */
const NO_TERMS_TYPES: ReadonlySet<string> = new Set(["widget", "widget_area"]);

/**
 * Any taxonomy on an entry whose collection exists here and is not tombstoned: nothing narrower is
 * recorded per collection to check against.
 * @complexity one indexed read per call.
 */
export function createLiveCollectionTermPolicy(deps: { contentTypeRepo: CollectionOwnerLookupPort; workspaceId: string }, _optional = {}): ContentTypeTaxonomyPolicyPort {
  return createJiniLiveCollectionTermPolicy({ ...deps, excludedTypes: NO_TERMS_TYPES });
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
}, _optional = {}): { contentLookup: ContentLookupPort; contentTypeTaxonomyPolicy: ContentTypeTaxonomyPolicyPort } {
  return createJiniContentTargetPorts({ ...deps, excludedTypes: NO_TERMS_TYPES });
}

/** The permission `contentType`'s own editor saves under: `content.write` for a post or page,
 *  `admin.collections.manage` for a collection entry. */
export function contentEditPermission({ contentType }: { contentType: string }, _optional = {}): string {
  return jiniContentEditPermission({ contentType, postPermission: "content.write", collectionPermission: "admin.collections.manage" });
}

/**
 * Throws `ForbiddenError` unless the caller may edit `contentType`'s content — tagging needs this on
 * top of `admin.taxonomy.manage`, which Jini checks for the write itself.
 * @complexity one `authorize()` call.
 */
export async function authorizeContentEdit(
  { deps, principalId, contentType }: { deps: { authorize: AuthorizeFn; workspaceId: string }; principalId: string; contentType: string },
  _optional = {},
): Promise<void> {
  return authorizeJiniContentEdit({ ...deps, principalId, contentType, postPermission: "content.write", collectionPermission: "admin.collections.manage" });
}
