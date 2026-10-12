import type { JsonObject } from '@jini-ai/core/primitives';
import type { PageHtmlEmbedRef } from './html/html-embeds.js';
import type { WidgetRenderIR } from './types.js';
import { galleryMediaReferences, parseGalleryConfig } from './markers/gallery.js';

export type GalleryMediaResolver = (required: { refs: readonly PageHtmlEmbedRef[] }, optional?: Record<string, never>) => Promise<ReadonlyMap<string, WidgetRenderIR>>;

export type GalleryIssueReporter = (required: { key: string | null; messages: readonly string[] }, optional?: Record<string, never>) => void;

/** Bound the media wait without taking ownership of the host repository's cancellation policy.
 * The port has no abort signal; an expired call may finish in the background but is never awaited
 * indefinitely and its timer is always released. No retries or duplicate repository calls.
 */
async function resolveGalleryMedia({ resolveMedia, refs, timeoutMs }: { resolveMedia: GalleryMediaResolver; refs: readonly PageHtmlEmbedRef[]; timeoutMs: number }): Promise<ReadonlyMap<string, WidgetRenderIR> | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolveMedia({ refs }),
      new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve bounded, deduplicated gallery assets through the existing media resolver port.
 * Occurrence keys preserve different layouts/alt/captions for the same assets on one page.
 * At the page media budget, whole later galleries degrade instead of silently losing images.
 * @complexity O(g*i) time/space for g markers and i<=50 images; one media batch of at most maxMedia.
 */
export async function resolveGalleryEmbeds(
  { refs, resolveMedia }: { refs: readonly PageHtmlEmbedRef[]; resolveMedia: GalleryMediaResolver },
  { maxMedia = 50, timeoutMs = 10000, reportIssue }: { maxMedia?: number; timeoutMs?: number; reportIssue?: GalleryIssueReporter } = {},
): Promise<ReadonlyMap<string, WidgetRenderIR>> {
  const accepted: PageHtmlEmbedRef[] = [];
  const legacyIds = new Set<string>();
  const slugKeys = new Set<string>();
  const mediaRefs = new Map<string, PageHtmlEmbedRef>();
  for (const ref of refs) {
    const config = ref.config?.content ?? ref.config;
    const parsed = parseGalleryConfig({ config }, { allowEmpty: ref.type === 'media' });
    if (!parsed.config || ref.id === null) {
      reportIssue?.({ key: ref.id, messages: parsed.errors });
      continue;
    }
    const ids = new Set(parsed.config.mode === 'html'
      ? galleryMediaReferences({ config: { html: parsed.config.html } }).map(item => item.mediaId)
      : parsed.config.images.flatMap(item => (item.slug ?? item.mediaId) === undefined ? [] : [(item.slug ?? item.mediaId)!]));
    const added = [...ids].filter(id => !mediaRefs.has(id));
    if (mediaRefs.size + added.length > maxMedia) {
      reportIssue?.({ key: ref.id, messages: [`gallery media exceeds the page budget of ${maxMedia} distinct assets`] });
      continue;
    }
    accepted.push({ ...ref, config: config as Readonly<Record<string, unknown>> });
    const legacy = parsed.config.mode === undefined;
    for (const key of ids) (legacy ? legacyIds : slugKeys).add(key);
    for (const id of added) mediaRefs.set(id, { type: 'media', id: legacy ? id : null, slug: legacy ? null : id, name: null, variant: null, header: true });
  }
  // No second repository lifecycle: media owns workspace lookup, visibility, transforms and metadata.
  const media = mediaRefs.size === 0 ? new Map<string, WidgetRenderIR>() : await resolveGalleryMedia({ resolveMedia, refs: [...mediaRefs.values()], timeoutMs });
  if (media === undefined) {
    reportIssue?.({ key: null, messages: ['gallery media resolution timed out'] });
    return new Map();
  }
  // Author-supplied ids are map keys, including names such as __proto__; never assign them onto
  // an object with a prototype or inherit a fake media record from Object.prototype.
  const imageProps: JsonObject = Object.create(null);
  for (const [id, ir] of media) {
    // Legacy mediaId is an indexed asset id, not the single-media marker's slug alias. The reused
    // media resolver accepts both; accepting a slug here would render an asset that the pure
    // entry_refs extractor cannot protect, since it cannot resolve a slug to the canonical id.
    // New slug content deliberately indexes authored keys; the host usage adapter reads id and slug.
    if (legacyIds.has(id) && !slugKeys.has(id)) {
      if (ir.props.assetId !== id) {
        reportIssue?.({ key: id, messages: ['gallery mediaId must be the canonical media id, not a slug'] });
        continue;
      }
      // A video resolved by the generic media pipeline is not an image in a legacy gallery.
      if (typeof ir.props.contentType === 'string' && (ir.props.contentType.startsWith('video/') || ir.props.contentType.startsWith('audio/'))) continue;
    }
    imageProps[id] = ir.props;
  }
  for (const key of slugKeys) if (!media.has(key)) reportIssue?.({ key, messages: [`unknown media slug: ${key}`] });
  return new Map(accepted.map(ref => [ref.id!, { componentId: ref.type === 'media' ? 'media' : 'gallery', props: { config: ref.config as JsonObject, media: imageProps } }]));
}
