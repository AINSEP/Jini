import { mediaFileExtension } from "../import/index.js";
import { isValidMediaSlugFormat } from "../slug.js";

/**
 * @file The one place that decides whether a `/m/...` URL is keyed by a media asset's id or its
 * slug, and the one place that templates that URL (ADR-027 §4's `/m/{key}/...` contract).
 *
 * Readable-slugs plan (2026-09-23), S1: every URL builder used to template `record.id` directly,
 * with one comment explaining why (`Jini/packages/cms/src/widgets/resolver-service.ts`'s pre-S2 note — a rename
 * would break a URL already baked into rendered HTML). That is no longer the reason to prefer the
 * id: `media_slug_history` (S2a/S2b) makes a retired slug keep resolving, so emitting the CURRENT
 * slug is safe. This slice only builds and tests the two functions; the four existing callers
 * (`site/render/doc/media-ref.ts`, `site/render/doc/nodes-media.ts`, `site/render/widgets/media.ts`, `Jini/packages/cms/src/seo/media.ts`'s `buildSeoImageUrl`,
 * `tool-registrations.ts`'s `resolveOneAssetPublicUrl`) move onto {@link mediaPublicPath} in this
 * same slice but keep passing the id, so their output is byte-identical. Actually emitting a slug
 * (calling {@link mediaUrlKey} at each call site) is S3/S4's job, once the rename-safety and
 * cache-split slices (S2a, S2b) are in.
 */

/** The minimal shape {@link mediaUrlKey} needs — a subset of `MediaRecord`, not the whole type, so
 *  a caller building a fake asset for a URL doesn't need to fake every field. */
export interface MediaUrlKeySource {
  readonly id: string;
  readonly slug?: string | null;
}

/**
 * The path segment a `/m/...` URL should use for this asset: its slug when the slug is present and
 * passes {@link isValidMediaSlugFormat} (imported from `@jini-ai/cms/media`, not re-implemented —
 * the format rule already lives with the code that enforces it at write time), otherwise its id.
 * A `null`/empty/malformed/UUID-shaped slug all fall back to the id, same as an asset that has
 * never had a slug assigned.
 *
 * @complexity O(1) — one regex test, no lookups.
 */
export function mediaUrlKey(asset: MediaUrlKeySource): string {
  const slug = asset.slug;
  if (slug && isValidMediaSlugFormat({ slug })) return slug;
  return asset.id;
}

/** Either variant of the `/m/{key}/...` URL contract (ADR-027 §4): the byte-passthrough original
 *  (used for video, and for any admin/original-blob link), or a versioned image transform.
 *  Original extensions use the stored, server-validated content type so static hosts can infer
 *  the same MIME type as the live server; never pass a client-declared upload type here. */
export type MediaPublicPathVariant =
  | { readonly kind: "original"; readonly contentType: string }
  | { readonly kind: "transform"; readonly name: string; readonly version: number; readonly ext: string };

/**
 * Templates a `/m/...` URL from an already-decided `key` (an id or a slug — see {@link mediaUrlKey})
 * and a variant. Every segment is `encodeURIComponent`-ed, same as the call sites this replaces
 * already did for the id; a plain asset id or the "public" transform name is unaffected by that
 * encoding (no reserved characters), so existing callers see byte-identical output when they keep
 * passing the id as `key`.
 *
 * @complexity O(1).
 */
export function mediaPublicPath({ key, variant, sha256 }: { key: string; variant: MediaPublicPathVariant; sha256?: string | null }, _optional: Record<string, never> = {}): string {
  const encodedKey = encodeURIComponent(key);
  // Source replacement keeps identity; the source hash makes newly rendered URLs select new bytes.
  const suffix = sha256 ? `?v=${encodeURIComponent(sha256.slice(0, 12))}` : "";
  if (variant.kind === "original") return `/m/${encodedKey}/original.${mediaFileExtension({ contentType: variant.contentType })}${suffix}`;
  return `/m/${encodedKey}/${encodeURIComponent(variant.name)}.v${variant.version}/image.${variant.ext}${suffix}`;
}
