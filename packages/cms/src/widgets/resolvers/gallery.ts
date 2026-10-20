import type { WidgetInstanceView, WidgetResolver, WidgetResolveResult } from '../types.js';
import type { GalleryMediaResolver } from '../gallery-resolver.js';
import { validateWidgetConfig } from '../config-validation.js';
import { getWidgetTypeRegistration } from '../registry.js';
import { resolveGalleryEmbeds } from '../gallery-resolver.js';
import { galleryMediaReferences, parseGalleryConfig } from '../markers/gallery.js';
import type { PageHtmlEmbedRef } from '../html/html-embeds.js';

/** Adapt gallery widget instances to the existing embed resolver; one deduplicated media batch.
 * Empty starter widgets render a note, while malformed stored configs degrade per instance.
 * @complexity O(w*i) time/space, with i<=50 images and a shared 50-asset budget.
 */
export function createGalleryWidgetResolver(
  { resolveMedia }: { resolveMedia: (required: Parameters<GalleryMediaResolver>[0] & { context: Parameters<WidgetResolver['resolveMany']>[1] }, optional?: Record<string, never>) => ReturnType<GalleryMediaResolver> },
  _optional: Record<string, never> = {},
): WidgetResolver {
  return { async resolveMany(instances, context) {
    const results = new Map<string, WidgetResolveResult>();
    const embedded: WidgetInstanceView[] = [];
    for (const instance of instances) {
      const settled = settleBeforeMedia({ instance });
      if (settled) results.set(instance.id, settled);
      else embedded.push(instance);
    }
    const refs = embedded.map(({ id, widgetType, config }): PageHtmlEmbedRef => ({ type: widgetType, id, slug: null, name: null, variant: null, header: true, config }));
    const resolved = await resolveGalleryEmbeds({ refs, resolveMedia: ({ refs }) => resolveMedia({ refs, context }) });
    for (const { id, config } of embedded) {
      const ir = resolved.get(id);
      results.set(id, ir ? { ok: true, ir, dependencyKeys: [id, ...galleryMediaReferences({ config }).map(image => image.mediaId)] } : { ok: false, reason: 'resolver-error' });
    }
    return results;
  } };
}

/** The outcome an instance gets without media: a rejected config or an empty starter.
 * Undefined means the instance joins the page's one shared embed batch.
 */
function settleBeforeMedia({ instance }: { instance: WidgetInstanceView }): WidgetResolveResult | undefined {
  const typeKey = instance.widgetType === 'media' ? 'media' : 'gallery';
  const parsed = parseGalleryConfig({ config: instance.config }, { allowEmpty: true });
  if (!parsed.config || !validateWidgetConfig({ schema: getWidgetTypeRegistration({ typeKey }).configSchema, config: instance.config }).valid) return { ok: false, reason: 'resolver-error' };
  if (parsed.config.images.length === 0 && parsed.config.mode !== 'html') {
    return { ok: true, ir: { componentId: typeKey, props: { config: instance.config, media: {} } }, dependencyKeys: [instance.id] };
  }
  return undefined;
}
