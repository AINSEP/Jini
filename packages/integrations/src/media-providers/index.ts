/**
 * `@jini-ai/integrations/media-providers` — multi-provider image/video/audio generation gateway:
 * provider/model types, the real vendor catalogue as reference data, an
 * injection-style capability registry, a pure video-request builder, an
 * async task-tracking port, a host-injected policy port, a generic
 * attachment-staging port, and (as of the dispatch engine) a real
 * multi-vendor REST dispatch engine covering an initial vendor slice — see
 * `source-map.md` for full provenance, exactly which vendors are ported vs
 * deferred, and this package's not-yet-locked status.
 */
export * from './types.js';
export * from './providers.js';
export * from './capability-registry.js';
export * from './seed.js';
export * from './video-request.js';
export * from './task-store.js';
export * from './policy.js';
export * from './staging.js';
export * from './tokens.js';
export * from './dispatch/index.js';
export * from './sqlite-task-store.js';
