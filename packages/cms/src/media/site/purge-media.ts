/** The host's reference adapter over the shared media purge lifecycle. */
import { purgeMedia as purgeSharedMedia, type PurgeMediaRequired } from '../index.js';
import { findMediaWhereUsed } from './where-used.js';

type ReferenceDeps = Parameters<typeof findMediaWhereUsed>[0]['deps'];

/** Check current post bodies and indexed references immediately before shared deletion.
 * @returns The shared purge result; reference lookup/removal failures propagate without retry.
 * @complexity O(post body bytes + indexed references), plus the shared purge's media scan.
 */
export async function purgeMedia(
  { deps, input }: { deps: Omit<PurgeMediaRequired['deps'], 'referenceCheck'> & ReferenceDeps; input: PurgeMediaRequired['input'] },
  optional: Record<string, never> = {},
): Promise<{ purged: true }> {
  return purgeSharedMedia({ deps: {
    ...deps,
    referenceCheck: { findReferences: async ({ workspaceId, media }) => {
      const usage = await findMediaWhereUsed({ deps, input: { workspaceId, mediaId: media.id, slug: media.slug } }, { includeTrashed: true });
      return usage.references.map(ref => `${ref.sourceEntryId}:${ref.fieldPath}`);
    } },
  }, input }, optional);
}
