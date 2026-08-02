/**
 * @file `@jini-ai/cms/server` — the Node-bound half of the CMS capability.
 *
 * PLACEHOLDER. Nothing has been ported yet.
 *
 * ## What belongs here
 *
 * Concrete implementations of the ports declared in `../core`: SQLite/Postgres repositories,
 * filesystem blob stores, image transformers — anything that imports `node:*` or a native
 * dependency. This layer depends on `../core`; the reverse is a boundary violation.
 *
 * ## What does NOT belong here
 *
 * HTTP routing and request/response handling. The source repo's `src/server/**` is an Express
 * composition root and is explicitly out of scope for this port — Jini already has
 * `@jini-ai/http-kit` and `@jini-ai/server` for transport. Porting those routes here would
 * reproduce exactly the coupling this package's layer split exists to prevent (see
 * `../core/index.ts`'s header for the measurements).
 *
 * The name of this subpath is `/server` for consistency with `@jini-ai/admin`'s Node layer, which
 * uses the same convention. It means "the Node-bound layer", not "the HTTP server".
 */

/**
 * Layer marker — same rationale as `CMS_CORE_LAYER`, and delete it on the same terms: once a real
 * adapter is exported from here, this has no purpose.
 */
export const CMS_SERVER_LAYER = 'server' as const;
