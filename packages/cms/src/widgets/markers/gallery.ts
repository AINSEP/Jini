import { decodeMarkerHtmlAttribute } from './marker.js';
import { isPlausibleMediaRefId } from './media-reference.js';

/** Inline gallery configuration; media resolution remains owned by the media embed pipeline. */
export interface GalleryImage {
  readonly mediaId?: string;
  readonly slug?: string;
  readonly src?: string;
  readonly alt?: string;
  readonly caption?: string;
}

export interface GalleryConfig {
  readonly images: readonly GalleryImage[];
  readonly layout: 'single' | 'grid' | 'carousel' | 'masonry';
  readonly mode?: 'media' | 'html';
  readonly html?: string;
  readonly htmlAttributes?: string;
  readonly cssClass?: string;
  readonly columns?: number;
  readonly aspectRatio?: string;
  readonly lightbox?: boolean;
}

export const MAX_GALLERY_IMAGES = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Same bounded, single-path-segment contract the media resolver accepts. No I/O. */
function validMediaId(value: unknown): value is string {
  return isPlausibleMediaRefId({ value });
}

/** Native URL parsing validates browser-loaded sources; hosts may enforce stricter URL policy. */
function validSource(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Numeric CSS ratio only: prevents configuration text becoming arbitrary CSS declarations. */
function validRatio(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?$/.test(value)) return false;
  return value.split('/').every(part => Number.isFinite(Number(part)) && Number(part) > 0);
}

/** Validate one image independently so a bad sibling never hides another image's diagnostics. */
function imageErrors(value: unknown, index: number): string[] {
  const path = `images[${index}]`;
  if (!isRecord(value)) return [`${path} must be an object`];
  const errors: string[] = [];
  if ((value.mediaId !== undefined) === (value.src !== undefined)) errors.push(`${path} requires exactly one of mediaId or src`);
  if (value.mediaId !== undefined && !validMediaId(value.mediaId)) errors.push(`${path}.mediaId must be a nonempty media id of at most 200 characters, without slashes or whitespace`);
  if (value.src !== undefined && !validSource(value.src)) errors.push(`${path}.src must be an HTTP(S) image URL without credentials, at most 2048 characters`);
  for (const key of ['alt', 'caption'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') errors.push(`${path}.${key} must be a string`);
  }
  return errors;
}

/** Pure validation result, with missing-alt warnings separate from fatal configuration errors.
 * Explicit alt="" denotes decorative content. Unknown keys remain available to host authoring.
 * @complexity O(n) time and space for at most 50 images; oversized arrays are rejected before walking.
 */
export function parseGalleryConfig({ config }: { config: unknown }, { allowEmpty = false }: { allowEmpty?: boolean } = {}): {
  config?: GalleryConfig;
  errors: string[];
  warnings: string[];
} {
  if (!isRecord(config)) return { errors: ['gallery config must be an object'], warnings: [] };
  if (config.mode !== undefined || config.items !== undefined || config.html !== undefined) return parseMediaContent({ config });
  if (!Array.isArray(config.images) || (!allowEmpty && config.images.length === 0) || config.images.length > MAX_GALLERY_IMAGES) {
    return { errors: [`images must contain between 1 and ${MAX_GALLERY_IMAGES} images`], warnings: [] };
  }
  const errors = config.images.flatMap(imageErrors);
  const warnings = config.images.flatMap((image, index) => isRecord(image) && image.alt === undefined
    ? [`images[${index}].alt is missing; supply alt text or an explicit empty string for a decorative image`] : []);
  if (typeof config.layout !== 'string' || !['grid', 'carousel', 'masonry'].includes(config.layout)) errors.push('layout must be grid, carousel or masonry');
  if (config.columns !== undefined && (!Number.isInteger(config.columns) || Number(config.columns) < 2 || Number(config.columns) > 6)) errors.push('columns must be an integer between 2 and 6');
  if (config.aspectRatio !== undefined && !validRatio(config.aspectRatio)) errors.push('aspectRatio must be a positive number or ratio such as 16/9');
  if (config.lightbox !== undefined && typeof config.lightbox !== 'boolean') errors.push('lightbox must be a boolean');
  if (errors.length > 0) return { errors, warnings };
  return { config: config as unknown as GalleryConfig, errors, warnings };
}

/** References describe authored intent even when another config field is invalid. Do not gate
 * safe-delete or export on successful rendering: that would hide the broken page needing protection.
 * Images beyond the renderable image cap cannot render and do not expand the reference index.
 * @complexity O(min(n,50)) time and space over the authored image list; no I/O or resolution.
 */
export function galleryMediaReferences({ config }: { config: unknown }, _optional: Record<string, never> = {}): readonly { mediaId: string; index: number }[] {
  if (!isRecord(config)) return [];
  const refs: { mediaId: string; index: number }[] = [];
  const items = Array.isArray(config.items) ? config.items : Array.isArray(config.images) ? config.images : [];
  for (const [index, item] of items.slice(0, MAX_GALLERY_IMAGES).entries()) {
    if (!isRecord(item)) continue;
    const key = item.slug ?? item.mediaId;
    if (validMediaId(key)) refs.push({ mediaId: key, index });
  }
  if (typeof config.html === 'string') {
    for (const key of mediaHtmlSlugs({ html: config.html })) refs.push({ mediaId: key, index: refs.length });
  }
  if (isRecord(config.content)) refs.push(...galleryMediaReferences({ config: config.content }));
  return refs;
}

/** Normalize the new slug-first content into the existing gallery render contract. Legacy images
 * remain read-only compatibility input; authored media items never accept raw URLs. O(n), n<=50. */
function parseMediaContent({ config }: { config: Record<string, unknown> }): ReturnType<typeof parseGalleryConfig> {
  const errors: string[] = [];
  const mode = config.mode ?? (config.html !== undefined ? 'html' : 'media');
  if (mode !== 'media' && mode !== 'html') errors.push('mode must be media or html');
  for (const key of ['htmlAttributes', 'cssClass'] as const) if (config[key] !== undefined && typeof config[key] !== 'string') errors.push(`${key} must be a string`);
  if (mode === 'html') {
    if (typeof config.html !== 'string' || config.html.length > 65536) errors.push('html must be a string of at most 65536 characters');
    return errors.length ? { errors, warnings: [] } : { config: { ...config, mode, images: [], layout: 'single' }, errors, warnings: [] };
  }
  if (!Array.isArray(config.items) || config.items.length > MAX_GALLERY_IMAGES) return { errors: ['items must be an array of at most 50 slug items'], warnings: [] };
  const images: GalleryImage[] = [];
  config.items.forEach((item, index) => {
    if (!isRecord(item)) { errors.push(`items[${index}] must be an object`); return; }
    if (!validMediaId(item.slug)) errors.push(`items[${index}].slug must be a nonempty slug of at most 200 characters without slashes or whitespace`);
    if (item.src !== undefined || item.mediaId !== undefined) errors.push(`items[${index}] uses slug, never src or mediaId`);
    for (const key of ['alt', 'caption'] as const) if (item[key] !== undefined && typeof item[key] !== 'string') errors.push(`items[${index}].${key} must be a string`);
    images.push(item as GalleryImage);
  });
  const requestedLayout = config.layout ?? 'single';
  let layout: GalleryConfig['layout'] = 'single';
  if (requestedLayout === 'single' || requestedLayout === 'grid' || requestedLayout === 'carousel' || requestedLayout === 'masonry') {
    layout = requestedLayout;
  } else {
    errors.push('layout must be single, grid, carousel or masonry');
  }
  if (config.columns !== undefined && (!Number.isInteger(config.columns) || Number(config.columns) < 1 || Number(config.columns) > 6)) errors.push('columns must be an integer between 1 and 6');
  if (config.aspectRatio !== undefined && !validRatio(config.aspectRatio)) errors.push('aspectRatio must be a positive number or ratio such as 16/9');
  if (errors.length) return { errors, warnings: [] };
  const normalized: GalleryConfig = { ...config, mode: 'media', images, layout };
  return { config: normalized, errors, warnings: [] };
}

/** Authored slug references, independent of render validity. Tokens and quoted data attributes
 * share the media reference key rules. Marker values are already entity-decoded by the scanner. */
export function mediaHtmlSlugs({ html }: { html: string }, _optional: Record<string, never> = {}): readonly string[] {
  const keys: string[] = [];
  for (const match of html.matchAll(/\{\{media:([^{}]+)\}\}/g)) {
    const key = decodeMarkerHtmlAttribute({ value: match[1]! });
    if (validMediaId(key)) keys.push(key);
  }
  for (const match of html.matchAll(/\bdata-media-slug\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const key = decodeMarkerHtmlAttribute({ value: match[1] ?? match[2] ?? match[3] ?? '' });
    if (validMediaId(key)) keys.push(key);
  }
  return keys;
}
