/** Slug-aware media usage over the existing reference index and post body scanner. Ordinary post
 * saves do not maintain entry_refs; read those current bodies instead of claiming a stale index
 * is complete. This is a host adapter over the host's separate post store, with no new persisted data. */
import type { EntryRefRow, EntryRefsRepoPort } from '../../widgets/ports.js';
import type { VersionedMediaRepoPort } from "../index.js";
import { collectReferencedMediaKeys } from '../../publish/content/media-references.js';

type WhereUsedPostReader = {
  list(required: { workspaceId: string }): Promise<readonly {
    readonly id: string;
    readonly deletedAt?: string | null;
    readonly bodyJson: unknown;
    readonly bodyHtml: string | null;
    readonly seoExtJson?: string | null;
    readonly bodyFormat: "doc" | "html";
  }[]>;
};

/** O(n) in current post body bytes plus indexed alias lookups; read-only and workspace-scoped. */
export async function findMediaWhereUsed(
  { deps, input }: { deps: { entryRefsRepo: Pick<EntryRefsRepoPort, 'findByTarget'>; postRepo: WhereUsedPostReader; mediaRepo: Pick<VersionedMediaRepoPort, 'listRetiredSlugs'> }; input: { workspaceId: string; mediaId: string; slug: string } },
  { includeTrashed = false }: { includeTrashed?: boolean } = {},
): Promise<{ count: number; references: readonly EntryRefRow[] }> {
  // Retired slugs still serve this asset. Renaming cannot make a live reference safe to purge.
  const retired = await deps.mediaRepo.listRetiredSlugs({ workspaceId: input.workspaceId, mediaId: input.mediaId });
  const keys = new Set([input.mediaId, input.slug, ...retired].filter(Boolean));
  const [indexed, posts] = await Promise.all([
    Promise.all([...keys].map(targetId => deps.entryRefsRepo.findByTarget({ workspaceId: input.workspaceId, targetKind: 'asset', targetId }))),
    deps.postRepo.list({ workspaceId: input.workspaceId }),
  ]);
  const postIds = new Set(posts.map(post => post.id));
  const references = new Map<string, EntryRefRow>();
  for (const row of indexed.flat()) {
    if (!postIds.has(row.sourceEntryId)) references.set(`${row.sourceEntryId}:${row.fieldPath}`, row);
  }
  for (const post of posts.filter(post => includeTrashed || post.deletedAt == null)) {
    const refs = collectReferencedMediaKeys({ state: { bodyJson: post.bodyJson, bodyHtml: post.bodyHtml, seoExtJson: post.seoExtJson } });
    if (![...refs].some(key => keys.has(key))) continue;
    const row: EntryRefRow = { workspaceId: input.workspaceId, sourceEntryId: post.id, sourceKind: 'config-field', fieldPath: post.bodyFormat === 'html' ? 'bodyHtml' : 'bodyJson', targetKind: 'asset', targetId: input.mediaId };
    references.set(`${post.id}:${row.fieldPath}`, row);
  }
  return { count: references.size, references: [...references.values()] };
}
