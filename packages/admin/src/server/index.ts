/**
 * @file `@jini-ai/admin/server` — the Node-only layer.
 *
 * Everything reachable from here may use Node built-ins (`node:fs`, `node:crypto`, `node:path`).
 * That is the whole reason this subpath exists separately from `./core`, which is universal and
 * dependency-free, and from `./browser`, which is DOM-bound but framework-free. `jini.entries` in
 * `package.json` records the per-subpath runtimes, and the R8 guard enforces that they stay
 * declared.
 *
 * One feature per directory. `composio/` is the first; a second server-side integration gets its
 * own sibling directory rather than being flattened in beside it, so that each feature's source,
 * tests, and provenance doc stay together.
 */
export * from './composio/index.js';
