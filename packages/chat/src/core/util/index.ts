/**
 * @module artifacts
 * Barrel for the artifact parsing/validation/recovery surface. Deliberately
 * omits `./markdown-context.js` and `./markup-attributes.js`, which are
 * internal implementation details shared by `./parser.js` and `./strip.js`
 * (and, for `markup-attributes.js`, `../question-form/scan.js`), not part
 * of this package's public API.
 */
export * from './types.js';
export * from './parser.js';
export * from './strip.js';
export * from './validate.js';
export * from './manifest.js';
export * from './recover.js';
export * from './pointer.js';
