/**
 * Compatibility root — re-exports `./core` unchanged so existing `from '@jini-ai/agentic'`
 * imports keep resolving. New code should prefer the explicit `@jini-ai/agentic/core` import;
 * see `core/README.md` for why this package is split the way it is.
 */
export * from './core/index.js';
