import { escapeHtml } from '@jini-ai/core/text';
import type { JsonObject } from '@jini-ai/core/primitives';
import { parseEmbedHtmlAttributes } from '../markers/html-attributes.js';
import { parseGalleryConfig, type GalleryConfig, type GalleryImage } from '../markers/gallery.js';

/** Layout-only baseline; host themes override jini classes/custom properties without palette coupling. */
export const GALLERY_STYLE = `<style data-jini-gallery-style>
.jini-gallery{gap:var(--jini-gallery-gap,1rem)}
.jini-gallery-item{margin:0;min-width:0;break-inside:avoid}
.jini-gallery audio{display:block;width:100%}
.jini-gallery img,.jini-gallery video{display:block;width:100%;height:auto;aspect-ratio:var(--jini-gallery-ratio,auto);object-fit:cover}
.jini-gallery-single{display:grid;grid-template-columns:1fr}
.jini-gallery-grid{display:grid;grid-template-columns:repeat(var(--jini-gallery-columns,3),minmax(0,1fr))}
.jini-gallery-masonry{columns:var(--jini-gallery-columns,3);column-gap:var(--jini-gallery-gap,1rem)}
.jini-gallery-masonry .jini-gallery-item{margin-block-end:var(--jini-gallery-gap,1rem)}
.jini-gallery-carousel{display:flex;overflow-x:auto;scroll-snap-type:x mandatory}
.jini-gallery-carousel .jini-gallery-item{flex:0 0 min(85%,36rem);scroll-snap-align:start}
@media(max-width:48rem){.jini-gallery-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.jini-gallery-masonry{columns:2}}
@media(max-width:30rem){.jini-gallery-grid{grid-template-columns:1fr}.jini-gallery-masonry{columns:1}}
</style>`;

export type GalleryImageRenderer = (required: { image: GalleryImage & { alt: string }; media: JsonObject | undefined }, optional?: Record<string, never>) => string;
type GalleryRawHtmlRenderer = (required: { html: string; media: Record<string, JsonObject> }, optional?: Record<string, never>) => string;

function mediaRecords(media: unknown): Record<string, JsonObject> {
  return typeof media === 'object' && media !== null && !Array.isArray(media) ? media as Record<string, JsonObject> : {};
}

/** Own-property lookup only, so a slug such as `toString` never resolves to an inherited member. */
function recordFor({ key, records }: { key: string | undefined; records: Record<string, JsonObject> }): JsonObject | undefined {
  return key !== undefined && Object.hasOwn(records, key) ? records[key] : undefined;
}

function storedAlt(media: JsonObject | undefined): string | undefined {
  return typeof media?.alt === 'string' && media.alt.length > 0 ? media.alt : undefined;
}

/** Render one ordered figure using the host's established image renderer and alt fallback.
 * Missing alt is flagged in markup as well as validation; an explicit empty alt stays decorative.
 */
function renderFigure({ image, records, renderImage }: { image: GalleryImage; records: Record<string, JsonObject>; renderImage: GalleryImageRenderer }): string {
  const key = image.slug ?? image.mediaId;
  const media = recordFor({ key, records });
  if (key !== undefined && !media) return '';
  const alt = image.alt ?? storedAlt(media);
  const missingAlt = alt === undefined ? ' data-jini-alt-missing="true"' : '';
  const markup = renderImage({ image: { ...image, alt: alt ?? '' }, media });
  const caption = image.caption === undefined ? '' : `<figcaption>${escapeHtml({ text: image.caption })}</figcaption>`;
  return `<figure class="jini-gallery-item"${missingAlt}>${markup}${caption}</figure>`;
}

function emptyGalleryNote(gallery: GalleryConfig): string {
  // Media-mode configs come from the Media widget editor; naming the Gallery editor there misleads.
  return `<div class="jini-gallery jini-gallery-empty" role="note">${gallery.mode === 'media' ? 'Choose media in the Media widget editor.' : 'Choose images in the Gallery widget editor.'}</div>`;
}

/** Wrapper attributes in emission order, with class and style split out for merging into the base. */
function wrapperAttributes(gallery: GalleryConfig): { extra: string; extraClass: string; authoredStyle: string | undefined } {
  // TODO: bind data-jini-lightbox through a host theme's lightbox script slot when one exists.
  // Until then the gallery stays readable and keyboard-scrollable without any client script.
  const attributes: Record<string, string> = {
    role: 'region', 'aria-label': gallery.mode === 'media' ? 'Media' : 'Image gallery',
    ...(gallery.layout === 'carousel' ? { tabindex: '0', 'aria-roledescription': 'carousel' } : {}),
    ...(gallery.lightbox === true ? { 'data-jini-lightbox': 'true' } : {}),
    ...parseEmbedHtmlAttributes({ text: gallery.htmlAttributes ?? '' }).attributes,
  };
  const extraClass = [gallery.cssClass, attributes.class].filter(Boolean).join(' ');
  delete attributes.class;
  // Layout styles remain the base; authored safe style declarations override them in order.
  const authoredStyle = attributes.style;
  delete attributes.style;
  const extra = Object.entries(attributes).map(([name, value]) => ` ${name}="${escapeHtml({ text: value })}"`).join('');
  return { extra, extraClass, authoredStyle };
}

function renderGalleryWrapper({ gallery, figures }: { gallery: GalleryConfig; figures: string }): string {
  const { extra, extraClass, authoredStyle } = wrapperAttributes(gallery);
  const ratio = gallery.aspectRatio === undefined ? '' : `;--jini-gallery-ratio:${gallery.aspectRatio}`;
  const classSuffix = extraClass ? ` ${escapeHtml({ text: extraClass })}` : '';
  const className = `jini-gallery jini-gallery-${gallery.layout}${classSuffix}`;
  const styleSuffix = authoredStyle ? `;${escapeHtml({ text: authoredStyle })}` : '';
  const style = `--jini-gallery-columns:${gallery.columns ?? 3}${ratio}${styleSuffix}`;
  return GALLERY_STYLE + `<div class="${className}"${extra} style="${style}">${figures}</div>`;
}

/** Server-render accessible gallery markup. Image URLs, metadata and srcset belong to the host
 * image pipeline supplied as a port, never templated here. Invalid config produces no output.
 * @complexity O(n) time and output space for at most 50 images, without I/O.
 */
export function renderGallery(
  { config, media, renderImage, renderRawHtml }: { config: unknown; media?: unknown; renderImage: GalleryImageRenderer; renderRawHtml?: GalleryRawHtmlRenderer },
  _optional: Record<string, never> = {},
): string {
  const gallery = parseGalleryConfig({ config }, { allowEmpty: true }).config;
  if (!gallery) return '';
  const records = mediaRecords(media);
  // parseGalleryConfig only admits html mode with a string `html`, so the cast cannot widen.
  if (gallery.mode === 'html') return renderRawHtml?.({ html: gallery.html as string, media: records }) ?? '';
  if (gallery.images.length === 0) return emptyGalleryNote(gallery);
  const figures = gallery.images.map(image => renderFigure({ image, records, renderImage })).join('');
  return renderGalleryWrapper({ gallery, figures });
}
