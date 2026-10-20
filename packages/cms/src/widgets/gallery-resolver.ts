import type { JsonObject } from '@jini-ai/core/primitives';
import type { PageHtmlEmbedRef } from './html/html-embeds.js';
import type { WidgetRenderIR } from './types.js';
import { galleryMediaReferences, parseGalleryConfig, type GalleryConfig } from './markers/gallery.js';

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

/** What the page's accepted gallery markers need from the one media batch. */
interface GalleryMediaPlan {
  readonly accepted: PageHtmlEmbedRef[];
  /** Keys authored as a legacy `images[].mediaId` (an indexed asset id). */
  readonly legacyIds: Set<string>;
  /** Keys authored as slug-first content (`items[].slug` or html `data-media-slug`). */
  readonly slugKeys: Set<string>;
  readonly mediaRefs: Map<string, PageHtmlEmbedRef>;
}

/** The distinct asset keys one parsed gallery config references. */
function galleryAssetKeys(config: GalleryConfig): Set<string> {
  if (config.mode === 'html') return new Set(galleryMediaReferences({ config: { html: config.html } }).map(item => item.mediaId));
  return new Set(config.images.flatMap(item => (item.slug ?? item.mediaId) === undefined ? [] : [(item.slug ?? item.mediaId)!]));
}

/** The media-resolver ref for one asset key: a legacy key is an id, anything else a slug. */
function mediaRefFor(key: string, legacy: boolean): PageHtmlEmbedRef {
  return { type: 'media', id: legacy ? key : null, slug: legacy ? null : key, name: null, variant: null, header: true };
}

/** Adds one marker to `plan` when its config parses, it has an occurrence key, and its new assets
 * fit the page budget; otherwise reports why and leaves `plan` untouched. */
function planGalleryRef({ plan, ref, maxMedia, reportIssue }: { plan: GalleryMediaPlan; ref: PageHtmlEmbedRef; maxMedia: number; reportIssue: GalleryIssueReporter }): void {
  const config = ref.config?.content ?? ref.config;
  const parsed = parseGalleryConfig({ config }, { allowEmpty: ref.type === 'media' });
  if (!parsed.config || ref.id === null) {
    reportIssue({ key: ref.id, messages: parsed.errors });
    return;
  }
  const ids = galleryAssetKeys(parsed.config);
  const added = [...ids].filter(id => !plan.mediaRefs.has(id));
  if (plan.mediaRefs.size + added.length > maxMedia) {
    reportIssue({ key: ref.id, messages: [`gallery media exceeds the page budget of ${maxMedia} distinct assets`] });
    return;
  }
  plan.accepted.push({ ...ref, config: config as Readonly<Record<string, unknown>> });
  const legacy = parsed.config.mode === undefined;
  for (const key of ids) (legacy ? plan.legacyIds : plan.slugKeys).add(key);
  for (const id of added) plan.mediaRefs.set(id, mediaRefFor(id, legacy));
}

/** Whether media resolved for a legacy `mediaId` key may render in a legacy gallery. */
function keepsLegacyMedia({ id, ir, reportIssue }: { id: string; ir: WidgetRenderIR; reportIssue: GalleryIssueReporter }): boolean {
  if (ir.props.assetId !== id) {
    reportIssue({ key: id, messages: ['gallery mediaId must be the canonical media id, not a slug'] });
    return false;
  }
  // A video resolved by the generic media pipeline is not an image in a legacy gallery.
  const contentType = ir.props.contentType;
  return !(typeof contentType === 'string' && (contentType.startsWith('video/') || contentType.startsWith('audio/')));
}

/** The resolved media props every accepted gallery on the page shares, keyed by authored key. */
function galleryImageProps({ media, plan, reportIssue }: { media: ReadonlyMap<string, WidgetRenderIR>; plan: GalleryMediaPlan; reportIssue: GalleryIssueReporter }): JsonObject {
  // Author-supplied ids are map keys, including names such as __proto__; never assign them onto
  // an object with a prototype or inherit a fake media record from Object.prototype.
  const imageProps: JsonObject = Object.create(null);
  for (const [id, ir] of media) {
    // Legacy mediaId is an indexed asset id, not the single-media marker's slug alias. The reused
    // media resolver accepts both; accepting a slug here would render an asset that the pure
    // entry_refs extractor cannot protect, since it cannot resolve a slug to the canonical id.
    // New slug content deliberately indexes authored keys; the host usage adapter reads id and slug.
    if (plan.legacyIds.has(id) && !plan.slugKeys.has(id) && !keepsLegacyMedia({ id, ir, reportIssue })) continue;
    imageProps[id] = ir.props;
  }
  return imageProps;
}

/** Resolve bounded, deduplicated gallery assets through the existing media resolver port.
 * Occurrence keys preserve different layouts/alt/captions for the same assets on one page.
 * At the page media budget, whole later galleries degrade instead of silently losing images.
 * @complexity O(g*i) time/space for g markers and i<=50 images; one media batch of at most maxMedia.
 */
export async function resolveGalleryEmbeds(
  { refs, resolveMedia }: { refs: readonly PageHtmlEmbedRef[]; resolveMedia: GalleryMediaResolver },
  { maxMedia = 50, timeoutMs = 10000, reportIssue = () => {} }: { maxMedia?: number; timeoutMs?: number; reportIssue?: GalleryIssueReporter } = {},
): Promise<ReadonlyMap<string, WidgetRenderIR>> {
  const plan: GalleryMediaPlan = { accepted: [], legacyIds: new Set(), slugKeys: new Set(), mediaRefs: new Map() };
  for (const ref of refs) planGalleryRef({ plan, ref, maxMedia, reportIssue });
  // No second repository lifecycle: media owns workspace lookup, visibility, transforms and metadata.
  const media = plan.mediaRefs.size === 0 ? new Map<string, WidgetRenderIR>() : await resolveGalleryMedia({ resolveMedia, refs: [...plan.mediaRefs.values()], timeoutMs });
  if (media === undefined) {
    reportIssue({ key: null, messages: ['gallery media resolution timed out'] });
    return new Map();
  }
  const imageProps = galleryImageProps({ media, plan, reportIssue });
  for (const key of plan.slugKeys) if (!media.has(key)) reportIssue({ key, messages: [`unknown media slug: ${key}`] });
  return new Map(plan.accepted.map(ref => [ref.id!, { componentId: ref.type === 'media' ? 'media' : 'gallery', props: { config: ref.config as JsonObject, media: imageProps } }]));
}
