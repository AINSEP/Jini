/** Universal redirects admin contracts, metadata, rules and headless controllers. */
export { redirectsModule } from './redirects.module.js';
export { redirectsApiToken, redirectsEventsToken } from './ports.js';
export type { AdminRedirectsPort, RedirectsEventsPort } from './ports.js';
export type { RedirectsMessageKey, RedirectsRowAction, RedirectsTranslate, RedirectsWriteState } from './models.js';
export { KEYS, REDIRECTS_RESOURCE, buildCreateRedirectPayload, firstWriteError, isAnyWritePending, nextRedirectStatus, parseImportPayload, redirectRowMenuItems, visibleRedirectsError } from './rules.js';
export type { ImportPayloadParseResult, RedirectRowMenuHandlers, WriteState } from './rules.js';
export { redirectsMessagesEn, translateRedirectsEn } from './messages.en.js';
export { createRedirectsController } from './controllers/redirects.controller.js';
export type { RedirectsActions } from './controllers/redirects.controller.js';
export { createImportRedirectsController } from './controllers/import-redirects.controller.js';
export type { ImportRedirectsActions } from './controllers/import-redirects.controller.js';
export { createHitCountController } from './controllers/hit-count.controller.js';
export type { AdminRedirect, AdminRedirectCreateInput, AdminRedirectUpdatePatch, AdminRedirectListFilter,
  AdminRedirectHitStats, AdminRedirectImportResult, AdminRedirectImportFailure,
  RedirectMatchType, RedirectStatusCode, RedirectSource, RedirectStatus } from '../core/ports/redirects.js';
