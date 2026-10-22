import { adminPort } from '../core/module/token.js';
import type { AdminRedirectsPort } from '../core/ports/redirects.js';
export type { AdminRedirectsPort } from '../core/ports/redirects.js';
/** Refresh notifications contain no rows; the authorized API remains the data owner. */
export interface RedirectsEventsPort {
  subscribe(listener: () => void): () => void;
}
export const redirectsApiToken = adminPort<AdminRedirectsPort, 'admin.redirects.api'>({ id: 'admin.redirects.api' });
export const redirectsEventsToken = adminPort<RedirectsEventsPort, 'admin.redirects.events'>({ id: 'admin.redirects.events' });
