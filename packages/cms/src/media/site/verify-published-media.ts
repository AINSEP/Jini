import { collectMediaUrlKeys } from "../../publish/content/media-references.js";
import type { PackedEntity } from "../../publish/transfer/index.js";
import type { MediaPublishPorts } from "../publish-ports.js";

import { computeBlobStorageKey } from "../blob-key.js";
import { findMediaByIdOrSlug } from "../media-service.js";
import { sniffContentType } from "../content-type-sniffer.js";

/**
 * @file Media's post-publish safety check (`PublishContentHandler.verifyApplied`), added after the
 * 2026-09-26 live bug: a published video rendered as a broken `<img>` because the receiving site had
 * no recorded content type for it, and its poster (named only in the video's `htmlAttributes`) was
 * never sent. Both went unreported. This runs on the RECEIVING site after the apply loop's rows have
 * landed and answers, per media item, "will this actually show?":
 *
 * - the row is here and its bytes are in the blob store (else nothing can be served);
 * - its content type is recorded — the only thing the embed resolver reads to choose `<video>` over
 *   `<img>`. A missing one is repaired by sniffing the stored bytes, exactly as the admin Media
 *   list's read-path backfill does (`@jini-ai/cms/media/site/content-type-resolution`), so a row published by an older
 *   build heals the next time a run carries it, even `unchanged`;
 * - every other media its `htmlAttributes` names by `/m/{key}/` URL (a video's `poster`) exists here.
 *
 * Cheap by design: point lookups per item, one batched type read, and a blob read only for the
 * (normally zero) items missing a type. Image renditions are NOT decoded here — they are generated on
 * first request, and proving one decodes would mean running the image transformer per item.
 */

type MediaPorts = MediaPublishPorts;

type VerifyFallback = <T>(
  required: { work: () => T | PromiseLike<T>; fallback: T; step: string },
  optional?: Record<string, never>,
) => Promise<T>;

/** A media item's operator-facing name: its slug, else its id. */
function labelOf(entity: PackedEntity): string {
  const slug = entity.state.slug;
  return typeof slug === "string" && slug.length > 0 ? slug : entity.id;
}

/** Records a sniffed type for `sha256` from the stored bytes. `false` when the bytes can't be read. */
async function repairContentType({ ports, workspaceId, sha256, orFallback }: { ports: MediaPorts; workspaceId: string; sha256: string; orFallback: VerifyFallback }, _optional: Record<string, never> = {}): Promise<boolean> {
  return orFallback({
    work: async () => {
      const bytes = await ports.blobStore.get({ storageKey: computeBlobStorageKey({ workspaceId, sha256 }) });
      await ports.contentTypeStore.set({ workspaceId, sha256, contentType: sniffContentType({ bytes }) });
      return true;
    },
    fallback: false,
    step: "verify-published-media.repair-content-type",
  }, {});
}

/** Problems with one media item, in the order an operator would fix them; stops at the first one
 *  that makes the rest meaningless (no row, no bytes). */
async function verifyOne(
  { ports, workspaceId, entity, recordedTypes, orFallback }: { ports: MediaPorts; workspaceId: string; entity: PackedEntity; recordedTypes: ReadonlyMap<string, string>; orFallback: VerifyFallback },
  _optional: Record<string, never> = {}
): Promise<string[]> {
  const label = labelOf(entity);
  const record = await ports.repo.findById({ workspaceId, id: entity.id });
  if (!record) return [`Media '${label}' was published but is not on the site.`];
  if (record.status !== "active") return [];

  const sha256 = record.source.sha256;
  if (!(await ports.blobStore.exists({ storageKey: computeBlobStorageKey({ workspaceId, sha256 }) }))) {
    return [`Media '${label}' is on the site without its file, so it cannot be shown.`];
  }
  const problems: string[] = [];
  if (!recordedTypes.has(sha256) && !(await repairContentType({ ports, workspaceId, sha256, orFallback }))) {
    problems.push(`Media '${label}': the site could not read its file type, so a video may show as a broken image.`);
  }
  for (const key of collectMediaUrlKeys({ text: record.htmlAttributes ?? "" })) {
    const named = await findMediaByIdOrSlug({ deps: { mediaRepo: ports.repo }, input: { workspaceId, idOrSlug: key } });
    if (!named) problems.push(`Media '${label}' uses '${key}' in its HTML attributes, but '${key}' is not on the site, so it will not load.`);
  }
  return problems;
}

/**
 * Every problem found across `entities` on the receiving site, as operator-facing lines. Never
 * throws for a per-item fault; each item's lines are independent.
 *
 * @complexity O(n) point lookups for `n` entities, plus one batched type read, plus one blob read
 * per item still missing a type.
 */
export async function verifyPublishedMedia(
  { ports, workspaceId, entities, orFallback }: { ports: MediaPorts; workspaceId: string; entities: readonly PackedEntity[]; orFallback: VerifyFallback },
  _optional: Record<string, never> = {}
): Promise<string[]> {
  if (entities.length === 0) return [];
  const sha256s = entities.flatMap((entity) => {
    const source = entity.state.source as { sha256?: unknown } | undefined;
    return typeof source?.sha256 === "string" ? [source.sha256] : [];
  });
  const recordedTypes = await ports.contentTypeStore.getMany({ workspaceId, sha256s });
  const problems: string[] = [];
  for (const entity of entities) {
    // A storage fault on one item is that item's problem; it must not hide the checks for the rest.
    problems.push(...(await orFallback({
      work: () => verifyOne({ ports, workspaceId, entity, recordedTypes, orFallback }),
      fallback: [`Media '${labelOf(entity)}' could not be checked on the site, so it may not show.`],
      step: "verify-published-media.verify-item",
    }, {})));
  }
  return problems;
}
