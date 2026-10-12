import { escapeHtml } from '@jini-ai/core/text';
import type { JsonObject } from '@jini-ai/core/primitives';
import { parseEmbedHtmlAttributes } from '../markers/html-attributes.js';
import { parseGalleryConfig, type GalleryImage } from '../markers/gallery.js';

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

/** Render one ordered figure using the host's established image renderer and alt fallback.
 * Missing alt is flagged in markup as well as validation; an explicit empty alt stays decorative.
 */
function renderFigure({ image, media, renderImage }: { image: GalleryImage; media: JsonObject | undefined; renderImage: GalleryImageRenderer }): string {
  if ((image.slug !== undefined || image.mediaId !== undefined) && !media) return '';
  const storedAlt = typeof media?.alt === 'string' && media.alt.length > 0 ? media.alt : undefined;
  const alt = image.alt ?? storedAlt;
  const missingAlt = alt === undefined ? ' data-jini-alt-missing="true"' : '';
  const markup = renderImage({ image: { ...image, alt: alt ?? '' }, media });
  const caption = image.caption === undefined ? '' : `<figcaption>${escapeHtml({ text: image.caption })}</figcaption>`;
  return `<figure class="jini-gallery-item"${missingAlt}>${markup}${caption}</figure>`;
}

/** Server-render accessible gallery markup. Image URLs, metadata and srcset belong to the host
 * image pipeline supplied as a port, never templated here. Invalid config produces no output.
 * @complexity O(n) time and output space for at most 50 images, without I/O.
 */
export function renderGallery(
  { config, media, renderImage, renderRawHtml }: { config: unknown; media?: unknown; renderImage: GalleryImageRenderer; renderRawHtml?: (required: { html: string; media: Record<string, JsonObject> }, optional?: Record<string, never>) => string },
  _optional: Record<string, never> = {},
): string {
  const parsed = parseGalleryConfig({ config }, { allowEmpty: true });
  if (!parsed.config) return '';
  const gallery = parsed.config;
  const records = typeof media === 'object' && media !== null && !Array.isArray(media) ? media as Record<string, JsonObject> : {};
  if (gallery.mode === 'html') return renderRawHtml?.({ html: gallery.html ?? '', media: records }) ?? '';
  // Media-mode configs come from the Media widget editor; naming the Gallery editor there misleads.
  if (gallery.images.length === 0) return `<div class="jini-gallery jini-gallery-empty" role="note">${gallery.mode === 'media' ? 'Choose media in the Media widget editor.' : 'Choose images in the Gallery widget editor.'}</div>`;
  const figures = gallery.images.map(image => renderFigure({ image, media: (image.slug ?? image.mediaId) !== undefined && Object.hasOwn(records, (image.slug ?? image.mediaId)!) ? records[(image.slug ?? image.mediaId)!] : undefined, renderImage })).join('');
  const ratio = gallery.aspectRatio === undefined ? '' : `;--jini-gallery-ratio:${gallery.aspectRatio}`;
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
  return GALLERY_STYLE + `<div class="jini-gallery jini-gallery-${gallery.layout}${extraClass ? ` ${escapeHtml({ text: extraClass })}` : ''}"${extra} style="--jini-gallery-columns:${gallery.columns ?? 3}${ratio}${authoredStyle ? `;${escapeHtml({ text: authoredStyle })}` : ''}">${figures}</div>`;
}
