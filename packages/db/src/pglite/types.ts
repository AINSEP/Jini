import type { PGlite } from "@electric-sql/pglite";

/**
 * @file The consumer-supplied PGlite class. Type-only: this package never imports
 * `@electric-sql/pglite` at runtime (the consumer passes `PGlite` in), so the one copy that runs is
 * the consumer's own.
 */

/** `typeof PGlite` from `@electric-sql/pglite` — pass the class itself: `{ PGlite }`. */
export type PgliteClass = typeof PGlite;
