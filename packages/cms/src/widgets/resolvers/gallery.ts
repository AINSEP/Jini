import type { WidgetResolver, WidgetResolveResult } from '../types.js';
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
    const refs: PageHtmlEmbedRef[] = [];
    const results = new Map<string, WidgetResolveResult>();
    for (const instance of instances) {
      const parsed = parseGalleryConfig({ config: instance.config }, { allowEmpty: true });
      if (!parsed.config || !validateWidgetConfig({ schema: getWidgetTypeRegistration({ typeKey: instance.widgetType === 'media' ? 'media' : 'gallery' }).configSchema, config: instance.config }).valid) { results.set(instance.id, { ok: false, reason: 'resolver-error' }); continue; }
      if (parsed.config.images.length === 0 && parsed.config.mode !== 'html') {
        results.set(instance.id, { ok: true, ir: { componentId: instance.widgetType === 'media' ? 'media' : 'gallery', props: { config: instance.config, media: {} } }, dependencyKeys: [instance.id] });
      } else refs.push({ type: instance.widgetType, id: instance.id, slug: null, name: null, variant: null, header: true, config: instance.config });
    }
    const resolved = await resolveGalleryEmbeds({ refs, resolveMedia: ({ refs }) => resolveMedia({ refs, context }) });
    for (const ref of refs) {
      const ir = resolved.get(ref.id!);
      results.set(ref.id!, ir ? { ok: true, ir, dependencyKeys: [ref.id!, ...galleryMediaReferences({ config: ref.config }).map(image => image.mediaId)] } : { ok: false, reason: 'resolver-error' });
    }
    return results;
  } };
}
