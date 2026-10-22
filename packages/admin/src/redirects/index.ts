/** Universal redirects admin contracts, metadata, rules and headless controllers. */
export { redirectsModule } from './redirects.module.js';
export * from './ports.js';
export * from './models.js';
export * from './rules.js';
export * from './messages.en.js';
export * from './controllers/redirects.controller.js';
export * from './controllers/import-redirects.controller.js';
export * from './controllers/hit-count.controller.js';
export type { AdminRedirect, AdminRedirectCreateInput, AdminRedirectUpdatePatch, AdminRedirectListFilter,
  AdminRedirectHitStats, AdminRedirectImportResult, AdminRedirectImportFailure,
  RedirectMatchType, RedirectStatusCode, RedirectSource, RedirectStatus } from '../core/ports/redirects.js';
