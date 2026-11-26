import { nowIso, type Clock } from "@jini-ai/core/primitives";
import type { DerivedMediaLinkPort, MediaRepoPort } from "@jini-ai/cms/media";

/**
 * Records, on the converted copy, which video it was made from. This host has no separate
 * "derived from" table, so the link is written into the copy's own plain-language description,
 * where the owner sees it in the library and search can find it. The copy is new, so its
 * description is empty; an existing description is never overwritten.
 *
 * @throws Error (plain words) when the copy cannot be found, so Jini removes the half-made copy.
 * @complexity O(1): one read and one save.
 */
export function createDerivedMediaLink(
  { mediaRepo, clock, description, refusal }: { mediaRepo: MediaRepoPort; clock: Clock; description: (required: { title: string }) => string; refusal: string },
  _optional: Record<string, never> = {},
): DerivedMediaLinkPort {
  return async ({ workspaceId, originalId, derivedId }) => {
    const [original, derived] = await Promise.all([
      mediaRepo.findById({ workspaceId, id: originalId }),
      mediaRepo.findById({ workspaceId, id: derivedId }),
    ]);
    if (!original || !derived) throw new Error(refusal);
    if (derived.description) return;
    await mediaRepo.save({ ...derived, description: description({ title: original.title }), updatedAt: nowIso({ clock }), version: derived.version + 1 });
  };
}
