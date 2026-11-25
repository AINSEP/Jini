import type { MediaRecord, TransformDefinitionRepoPort } from "../index.js";
import { getLatestTransformDefinition } from "../transform-registry.js";
import { CORE_PUBLIC_TRANSFORM_NAME } from "./bootstrap.js";
import type { MediaContentTypeStorePort } from "./content-type-store.js";
import { mediaPublicPath, mediaUrlKey } from "./public-path.js";

/**
 * @file Batch-resolves each media asset's `/m/...` public URL, the real implementation behind
 * `MediaToolDeps.resolvePublicUrls`. Images resolve to the latest registered "public" core transform
 * rendition; original-byte video/audio/SVG resolve to the byte-passthrough original. A host supplies
 * the two lookups (recorded content types, transform definitions) as ports, so no store is reached
 * from here.
 */

/** Cosmetic only (never participates in the rendition lookup itself); it
 *  duplicates `seo/media.ts`'s identical local copy rather than sharing it. */
const EXT_BY_TRANSFORM_FORMAT: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp", gif: "gif" };

type LatestTransform = Awaited<ReturnType<typeof getLatestTransformDefinition>>;

/**
 * One asset's resolved URL: the per-asset decision {@link resolveMediaPublicUrls} extracts so its
 * own batch loop is pure assembly. `null` covers "no registered 'public' core transform yet" (boot
 * has not run `ensureCoreMediaTransform`, or this is a test double with no transform registered).
 */
function resolveOneAssetPublicUrl(
  { asset, contentTypes, latest }: { asset: MediaRecord; contentTypes: ReadonlyMap<string, string>; latest: LatestTransform },
  _optional: Record<string, never> = {},
): string | null {
  const key = mediaUrlKey(asset);
  const contentType = contentTypes.get(asset.source.sha256);
  if (contentType === "image/svg+xml" || contentType?.startsWith("video/") || contentType?.startsWith("audio/")) return mediaPublicPath({ key, sha256: asset.source.sha256, variant: { kind: "original", contentType } });
  if (!latest) return null;
  const ext = EXT_BY_TRANSFORM_FORMAT[latest.params.format] ?? latest.params.format;
  return mediaPublicPath({ key, sha256: asset.source.sha256, variant: { kind: "transform", name: CORE_PUBLIC_TRANSFORM_NAME, version: latest.version, ext } });
}

/**
 * Batch-resolves each of `assets`' `/m/...` public URL.
 *
 * `contentTypeStore` and `transformRepo` are `null` when the host did not wire that port: without a
 * content-type store every asset is unresolved; without a transform repo images stay unresolved
 * while sniffed audio/video/SVG still resolve through their owner (original-byte players do not
 * depend on image-transform registration).
 *
 * @returns a map from `MediaRecord.id` to its resolved URL, or `null` for a trashed asset, a
 * document, an asset with no registered "public" core transform yet, or any other unresolvable case,
 * so a link a visitor would 404 on is never produced.
 * @complexity O(1) queries regardless of `assets.length`: one batched content-type lookup, one latest-
 * transform-version lookup (workspace-wide, not per-asset).
 */
export async function resolveMediaPublicUrls(
  required: {
    assets: readonly MediaRecord[];
    workspaceId: string;
    contentTypeStore: Pick<MediaContentTypeStorePort, "getMany"> | null;
    transformRepo: TransformDefinitionRepoPort | null;
  },
  _optional: Record<string, never> = {},
): Promise<Map<string, string | null>> {
  const { assets, workspaceId, contentTypeStore, transformRepo } = required;
  const result = new Map<string, string | null>();
  if (!contentTypeStore) {
    for (const asset of assets) result.set(asset.id, null);
    return result;
  }

  const active: MediaRecord[] = [];
  for (const asset of assets) {
    if (asset.kind === "document" || asset.status === "trashed") result.set(asset.id, null);
    else active.push(asset);
  }
  if (active.length === 0) return result;

  const sha256s = [...new Set(active.map((asset) => asset.source.sha256))];
  const contentTypes = await contentTypeStore.getMany({ workspaceId, sha256s });

  const latest = transformRepo ? await getLatestTransformDefinition({
    deps: { transformRepo },
    input: { workspaceId, name: CORE_PUBLIC_TRANSFORM_NAME },
  }) : null;

  for (const asset of active) {
    result.set(asset.id, resolveOneAssetPublicUrl({ asset, contentTypes, latest }));
  }
  return result;
}
