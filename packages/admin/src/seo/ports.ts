import { adminPort } from '../core/module/token.js';
import type { AdminSeoPort } from '../core/ports/seo.js';
export type { AdminSeoPort } from '../core/ports/seo.js';
export const seoApiToken = adminPort<AdminSeoPort, 'admin.seo.api'>({ id: 'admin.seo.api' });
/** A host event invalidates this scope's settings; it carries no unauthorized rows. */
export interface SeoEventsPort {
  subscribe(required: { onRefresh: () => void }, optional?: Record<string, never>): () => void;
}
export const seoEventsToken = adminPort<SeoEventsPort, 'admin.seo.events'>({ id: 'admin.seo.events' });
