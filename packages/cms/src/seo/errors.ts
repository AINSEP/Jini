/**
 * @file Typed domain errors for `seo` (SPEC-008 errors.spec.md §2).
 *
 * Purpose:
 * One class per error this module originates, mirroring
 * `features/settings/errors.ts`'s one-class-per-code convention. Route
 * handlers (`src/server/routes/admin/seo/*.ts`) map these 1:1 to the HTTP
 * codes in api.spec.md §6. `FORBIDDEN` reuses `core/commands`'s shared
 * `ForbiddenError` (same authorize-then-throw shape `write-service.ts`'s
 * settings counterpart and every command-gateway route already use) rather
 * than a second, SEO-local class — `UNAUTHENTICATED` is a route/session-
 * middleware concern (`getAuthedPrincipal`), never thrown by this module.
 */
export class SeoFieldValidationError extends Error {}
export class SeoInvalidCanonicalUrlError extends Error {}
export class SeoEntryNotFoundError extends Error {}
export class SeoSettingsValidationError extends Error {}
/**
 * A concurrent write kept an SEO override from landing (2026-09-07, fable bugs audit SEO-01).
 *
 * `setEntrySeoOverrides` writes the whole `posts` row, so it now writes it under a version
 * predicate and re-reads/re-merges when another writer wins the row. This error is what remains
 * after that bounded retry is exhausted — a row being rewritten faster than this chokepoint can
 * merge onto it. Deliberately its own class rather than reusing `features/post`'s
 * `PostVersionConflictError`: no SEO caller states a version basis, so there is no basis to report
 * back and nothing for the client to reconcile — the honest answer is "retry", not "your version
 * was N and theirs is M".
 */
export class SeoConcurrentWriteError extends Error {}
