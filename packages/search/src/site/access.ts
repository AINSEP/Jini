/**
 * @file The fail-closed last check before a search hit is shown (`@jini-ai/search`'s
 * `SearchAccessPort`) for the CMS's posts and pages. A provider's index may lag the database; this
 * re-reads the rows the hits name, in one query per collection, and keeps only the keys that are
 * live right now and, when member-gated, open to one of the viewer's audiences.
 *
 * Fails closed: a key of another site or workspace, of an unknown collection, of a missing,
 * draft, trashed or still-scheduled row, or with an unreadable gate is never visible.
 */
import type { Kysely } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import { encodeSearchKey, type SearchDocumentKey } from "../contract.js";
import type { SearchAccessPort } from "../ports.js";
/** The member-context fields search reads; the host's member context satisfies it structurally. */
type SearchMemberContext = { readonly isAuthenticated: boolean; readonly activeTierIds: readonly string[]; readonly isPaid: boolean };
import {
  CMS_SEARCH_COLLECTIONS, MEMBER_AUDIENCE, cmsSearchVisibility, isRowLive, toNowIso,
  type CmsSearchKernel, type CmsSearchResolveMemberAccess, type CmsSearchRules,
} from "./cms-document-source.js";

/**
 * A viewer's search audiences, from their validated member context (never from request input):
 * none for an anonymous viewer, otherwise `members`, `paid` when entitled, and one token per tier.
 * Uses the same tokens `cmsSearchVisibility` writes, so the two cannot drift apart.
 * @complexity O(a) in the active tier count.
 */
export function memberSearchAudiences(required: { context: SearchMemberContext }, _optional: Record<string, never> = {}): string[] {
  const { context } = required;
  if (!context.isAuthenticated) return [];
  return [MEMBER_AUDIENCE.members, ...(context.isPaid ? [MEMBER_AUDIENCE.paid] : []), ...context.activeTierIds.map((tierId) => MEMBER_AUDIENCE.tier({ tierId }))];
}

/** Whether a gated row is open to any of `audiences`. @complexity O(r·a), both small. */
function audienceAllows(
  { memberAccessJson, audiences, resolveMemberAccess }: { memberAccessJson: string | null; audiences: readonly string[]; resolveMemberAccess: CmsSearchResolveMemberAccess },
  _optional = {},
): boolean {
  const visibility = cmsSearchVisibility({ memberAccessJson, resolveMemberAccess });
  return visibility.kind === "public" || visibility.audiences.some(audience => audiences.includes(audience));
}

/** Keys grouped by known collection; keys of other sites and unknown collections are dropped here.
 *  @complexity O(k). */
function groupKeys({ siteId, keys, collections }: { siteId: string; keys: readonly SearchDocumentKey[]; collections: readonly string[] }, _optional = {}): Map<string, SearchDocumentKey[]> {
  const groups = new Map<string, SearchDocumentKey[]>();
  for (const key of keys) {
    const collection = key.collection;
    if (key.siteId !== siteId || !collections.includes(collection)) continue;
    groups.set(collection, [...(groups.get(collection) ?? []), key]);
  }
  return groups;
}

/**
 * The access port over one site's content database. Generic over the host's schema `DB`: the host
 * kernel is borrowed through the `posts` slice search reads.
 * @example createCmsSearchAccessPort({ kernel, now, isLiveAt, resolveMemberAccess }).visibleKeys({ siteId, keys, audiences })
 * @complexity visibleKeys: one indexed query per collection present among the keys, O(k) work.
 */
export function createCmsSearchAccessPort<DB>(
  required: { readonly kernel: StorageKernel<Kysely<DB>, DB>; readonly now: () => number } & CmsSearchRules,
  optional: { readonly collections?: readonly string[] } = {},
): SearchAccessPort {
  const { now, isLiveAt, resolveMemberAccess } = required;
  const kernel = required.kernel as unknown as CmsSearchKernel;
  const collections = optional.collections ?? CMS_SEARCH_COLLECTIONS;
  return {
    async visibleKeys({ siteId, keys, audiences }) {
      const nowIso = toNowIso({ nowMs: now() });
      const visible = new Set<string>();
      for (const [collection, group] of groupKeys({ siteId, keys, collections })) {
        const rows = await kernel.run(db => db.selectFrom("posts")
          .select(["id", "workspace_id", "status", "publish_at", "deleted_at", "member_access_json"])
          .where("kind", "=", collection).where("id", "in", group.map(key => key.documentId)).execute());
        const byId = new Map(rows.map(row => [row.id, row]));
        for (const key of group) {
          const row = byId.get(key.documentId);
          // The workspace is part of the key: a hit can never borrow another workspace's row.
          if (row?.workspace_id !== key.workspaceId || !isRowLive({ row, nowIso, isLiveAt }) || !audienceAllows({ memberAccessJson: row.member_access_json, audiences, resolveMemberAccess })) continue;
          visible.add(encodeSearchKey({ key }));
        }
      }
      return visible;
    },
  };
}
