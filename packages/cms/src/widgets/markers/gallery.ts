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

const ASPECT_RATIO_ERROR = 'aspectRatio must be a positive number or ratio such as 16/9';
const LEGACY_LAYOUTS: readonly string[] = ['grid', 'carousel', 'masonry'];
const MEDIA_LAYOUTS: readonly string[] = ['single', ...LEGACY_LAYOUTS];

/** `${path}.alt`/`${path}.caption` (or bare `${key}` with no path) type errors for optional text fields. */
function stringFieldErrors({ record, keys }: { record: Record<string, unknown>; keys: readonly string[] }, { path }: { path?: string } = {}): string[] {
  const prefix = path === undefined ? '' : `${path}.`;
  return keys.filter(key => record[key] !== undefined && typeof record[key] !== 'string')
    .map(key => `${prefix}${key} must be a string`);
}

/** Columns are optional; when present they must be an integer in [min, 6]. */
function invalidColumns({ columns }: { columns: unknown }, { min }: { min: number }): boolean {
  return columns !== undefined && (!Number.isInteger(columns) || Number(columns) < min || Number(columns) > 6);
}

function invalidAspectRatio(value: unknown): boolean {
  return value !== undefined && !validRatio(value);
}

/** Validate one image independently so a bad sibling never hides another image's diagnostics. */
function imageErrors(value: unknown, index: number): string[] {
  const path = `images[${index}]`;
  if (!isRecord(value)) return [`${path} must be an object`];
  const errors: string[] = [];
  if ((value.mediaId !== undefined) === (value.src !== undefined)) errors.push(`${path} requires exactly one of mediaId or src`);
  if (value.mediaId !== undefined && !validMediaId(value.mediaId)) errors.push(`${path}.mediaId must be a nonempty media id of at most 200 characters, without slashes or whitespace`);
  if (value.src !== undefined && !validSource(value.src)) errors.push(`${path}.src must be an HTTP(S) image URL without credentials, at most 2048 characters`);
  errors.push(...stringFieldErrors({ record: value, keys: ['alt', 'caption'] }, { path }));
  return errors;
}

function missingAltWarnings(images: readonly unknown[]): string[] {
  return images.flatMap((image, index) => isRecord(image) && image.alt === undefined
    ? [`images[${index}].alt is missing; supply alt text or an explicit empty string for a decorative image`] : []);
}

function validImageCount(images: unknown, { allowEmpty }: { allowEmpty: boolean }): images is unknown[] {
  return Array.isArray(images) && (allowEmpty || images.length > 0) && images.length <= MAX_GALLERY_IMAGES;
}

function legacyOptionErrors(config: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (typeof config.layout !== 'string' || !LEGACY_LAYOUTS.includes(config.layout)) errors.push('layout must be grid, carousel or masonry');
  if (invalidColumns({ columns: config.columns }, { min: 2 })) errors.push('columns must be an integer between 2 and 6');
  if (invalidAspectRatio(config.aspectRatio)) errors.push(ASPECT_RATIO_ERROR);
  if (config.lightbox !== undefined && typeof config.lightbox !== 'boolean') errors.push('lightbox must be a boolean');
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
  const images = config.images;
  if (!validImageCount(images, { allowEmpty })) {
    return { errors: [`images must contain between 1 and ${MAX_GALLERY_IMAGES} images`], warnings: [] };
  }
  const errors = [...images.flatMap(imageErrors), ...legacyOptionErrors(config)];
  const warnings = missingAltWarnings(images);
  if (errors.length > 0) return { errors, warnings };
  return { config: config as unknown as GalleryConfig, errors, warnings };
}

/** Authored items, else legacy images, else nothing. */
function authoredItems(config: Record<string, unknown>): readonly unknown[] {
  if (Array.isArray(config.items)) return config.items;
  return Array.isArray(config.images) ? config.images : [];
}

/** References describe authored intent even when another config field is invalid. Do not gate
 * safe-delete or export on successful rendering: that would hide the broken page needing protection.
 * Images beyond the renderable image cap cannot render and do not expand the reference index.
 * @complexity O(min(n,50)) time and space over the authored image list; no I/O or resolution.
 */
export function galleryMediaReferences({ config }: { config: unknown }, _optional: Record<string, never> = {}): readonly { mediaId: string; index: number }[] {
  if (!isRecord(config)) return [];
  const refs: { mediaId: string; index: number }[] = [];
  for (const [index, item] of authoredItems(config).slice(0, MAX_GALLERY_IMAGES).entries()) {
    const key = isRecord(item) ? item.slug ?? item.mediaId : undefined;
    if (validMediaId(key)) refs.push({ mediaId: key, index });
  }
  if (typeof config.html === 'string') {
    for (const key of mediaHtmlSlugs({ html: config.html })) refs.push({ mediaId: key, index: refs.length });
  }
  if (isRecord(config.content)) refs.push(...galleryMediaReferences({ config: config.content }));
  return refs;
}

function mediaItemErrors(item: unknown, index: number): string[] {
  const path = `items[${index}]`;
  if (!isRecord(item)) return [`${path} must be an object`];
  const errors: string[] = [];
  if (!validMediaId(item.slug)) errors.push(`${path}.slug must be a nonempty slug of at most 200 characters without slashes or whitespace`);
  if (item.src !== undefined || item.mediaId !== undefined) errors.push(`${path} uses slug, never src or mediaId`);
  errors.push(...stringFieldErrors({ record: item, keys: ['alt', 'caption'] }, { path }));
  return errors;
}

function mediaOptionErrors(config: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!MEDIA_LAYOUTS.includes(config.layout as string ?? 'single')) errors.push('layout must be single, grid, carousel or masonry');
  if (invalidColumns({ columns: config.columns }, { min: 1 })) errors.push('columns must be an integer between 1 and 6');
  if (invalidAspectRatio(config.aspectRatio)) errors.push(ASPECT_RATIO_ERROR);
  return errors;
}

function parseHtmlContent({ config, errors }: { config: Record<string, unknown>; errors: string[] }): ReturnType<typeof parseGalleryConfig> {
  if (typeof config.html !== 'string' || config.html.length > 65536) errors.push('html must be a string of at most 65536 characters');
  return errors.length ? { errors, warnings: [] } : { config: { ...config, mode: 'html', images: [], layout: 'single' }, errors, warnings: [] };
}

function parseMediaItems({ config, errors }: { config: Record<string, unknown>; errors: string[] }): ReturnType<typeof parseGalleryConfig> {
  const items = config.items;
  if (!Array.isArray(items) || items.length > MAX_GALLERY_IMAGES) return { errors: ['items must be an array of at most 50 slug items'], warnings: [] };
  errors.push(...items.flatMap(mediaItemErrors), ...mediaOptionErrors(config));
  if (errors.length) return { errors, warnings: [] };
  // Validated above: every item is a record and the layout is one of MEDIA_LAYOUTS.
  const layout = (config.layout ?? 'single') as GalleryConfig['layout'];
  const normalized: GalleryConfig = { ...config, mode: 'media', images: [...items] as GalleryImage[], layout };
  return { config: normalized, errors, warnings: [] };
}

/** Normalize the new slug-first content into the existing gallery render contract. Legacy images
 * remain read-only compatibility input; authored media items never accept raw URLs. O(n), n<=50. */
function parseMediaContent({ config }: { config: Record<string, unknown> }): ReturnType<typeof parseGalleryConfig> {
  const mode = config.mode ?? (config.html !== undefined ? 'html' : 'media');
  const errors = mode === 'media' || mode === 'html' ? [] : ['mode must be media or html'];
  errors.push(...stringFieldErrors({ record: config, keys: ['htmlAttributes', 'cssClass'] }));
  return mode === 'html' ? parseHtmlContent({ config, errors }) : parseMediaItems({ config, errors });
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
    // Exactly one of the three value alternatives (double-quoted, single-quoted, bare) always matches.
    const key = decodeMarkerHtmlAttribute({ value: (match[1] ?? match[2] ?? match[3])! });
    if (validMediaId(key)) keys.push(key);
  }
  return keys;
}
