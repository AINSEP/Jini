import type { AdminWidgetType, WidgetTypeOption } from '../../../models.js';
// Host-owned catalog/defaults copied as fixtures only, never imported by production widgets.
export const widgetTypes: WidgetTypeOption[] = [
  { value: 'text', label: 'Text' }, { value: 'social-links', label: 'Social Links' },
  { value: 'recent-entries', label: 'Collection list' }, { value: 'menu', label: 'Menu' }, { value: 'contact-form', label: 'Contact Form' },
];
export function defaultConfig(type: AdminWidgetType): Record<string, unknown> {
  switch (type) { case 'text': return { body: '' }; case 'social-links': return { links: [] }; case 'recent-entries': return { maxItems: 5 }; case 'menu': return { menuRef: '' }; case 'contact-form': return { formDefinitionId: '' }; default: return {}; }
}
export function slugRedirectPath(base: string, requestedId: string, item: { id: string; slug: string }): string | null {
  if (requestedId === item.slug || requestedId !== item.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedId)) return null;
  return `${base}/${item.slug}`;
}
