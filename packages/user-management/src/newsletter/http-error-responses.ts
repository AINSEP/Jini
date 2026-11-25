import {
  NewsletterCampaignNotEditableError,
  NewsletterCampaignNotFoundError,
  NewsletterConflictError,
  NewsletterDefaultListProtectedError,
  NewsletterForbiddenError,
  NewsletterLaunchGateBlockedError,
  NewsletterListNotFoundError,
  NewsletterSubscriberNotFoundError,
  NewsletterSubscriptionNotFoundError,
  NewsletterValidationError,
} from "./errors.js";

/**
 * @file The newsletter typed-error -> HTTP table, owned here because the error classes are this
 * feature's. The admin route specs (`@jini-ai/cms/admin-http/routes/newsletter/*`) receive it as
 * their injected `mapNewsletterError`; anything it does not own answers `undefined`, so the spec
 * rethrows it and the admin failure port writes the redacted 500 (operation `http/newsletter`).
 */

/**
 * Ordered `errorClass -> mapper` table backing `newsletterErrorResponse`. Order matters only in
 * that every listed class must be checked before the unmapped fallthrough — the classes
 * themselves are disjoint (none is a subclass of another here), so relative order among them is
 * not significant.
 */
const NEWSLETTER_ERROR_MAPPERS: ReadonlyArray<
  readonly [abstract new (...args: never[]) => Error, (err: never) => { status: number; body: Record<string, unknown> }]
> = [
  [
    NewsletterValidationError,
    (err: NewsletterValidationError) => ({
      status: 400,
      body: { error: err.message, code: "NEWSLETTER_VALIDATION_ERROR", details: { field: err.field, reason: err.reason } },
    }),
  ],
  [
    NewsletterSubscriberNotFoundError,
    (err: NewsletterSubscriberNotFoundError) => ({
      status: 400,
      body: { error: err.message, code: "NEWSLETTER_SUBSCRIBER_NOT_FOUND", details: { subscriberId: err.subscriberId } },
    }),
  ],
  [
    NewsletterCampaignNotEditableError,
    (err: NewsletterCampaignNotEditableError) => ({
      status: 409,
      body: {
        error: err.message,
        code: "NEWSLETTER_CAMPAIGN_NOT_EDITABLE",
        details: { currentStatus: err.currentStatus, attemptedAction: err.attemptedAction },
      },
    }),
  ],
  [
    NewsletterDefaultListProtectedError,
    (err: NewsletterDefaultListProtectedError) => ({
      status: 409,
      body: { error: err.message, code: "NEWSLETTER_DEFAULT_LIST_PROTECTED", details: { listId: err.listId } },
    }),
  ],
  [
    NewsletterConflictError,
    (err: NewsletterConflictError) => ({
      status: 409,
      body: {
        error: err.message,
        code: "NEWSLETTER_CONFLICT",
        details: { entity: err.entity, id: err.id, expectedVersion: err.expectedVersion, actualVersion: err.actualVersion },
      },
    }),
  ],
  [
    NewsletterLaunchGateBlockedError,
    (err: NewsletterLaunchGateBlockedError) => ({
      status: 409,
      body: { error: err.message, code: "NEWSLETTER_LAUNCH_GATE_BLOCKED", details: { unmetPreconditions: err.unmetPreconditions } },
    }),
  ],
  [
    NewsletterCampaignNotFoundError,
    (err: NewsletterCampaignNotFoundError) => ({ status: 404, body: { error: err.message, code: "NEWSLETTER_CAMPAIGN_NOT_FOUND" } }),
  ],
  [
    NewsletterListNotFoundError,
    (err: NewsletterListNotFoundError) => ({ status: 404, body: { error: err.message, code: "NEWSLETTER_LIST_NOT_FOUND" } }),
  ],
  [
    NewsletterSubscriptionNotFoundError,
    (err: NewsletterSubscriptionNotFoundError) => ({ status: 404, body: { error: err.message, code: "NEWSLETTER_SUBSCRIPTION_NOT_FOUND" } }),
  ],
  [NewsletterForbiddenError, (err: NewsletterForbiddenError) => ({ status: 403, body: { error: err.message, code: "FORBIDDEN" } })],
];

/**
 * Pure typed-error -> `{status, body}` mapping, applied uniformly across every admin route
 * (errors.spec.md §2 is the canonical code -> HTTP-status registry; api.spec.md §6's per-endpoint
 * tables are a representative, non-exhaustive subset of which of these codes each endpoint's
 * underlying chokepoint can actually raise — e.g. `CREATE_CAMPAIGN`/`SCHEDULE_CAMPAIGN` can both
 * surface `NEWSLETTER_LIST_NOT_FOUND` via `campaign-write-service.ts`'s `requireEditableListId`
 * even though that endpoint's own api.spec.md row doesn't separately enumerate it). `undefined`
 * for an error this feature does not own.
 * @complexity O(n) in the fixed 10-entry table.
 */
export function newsletterErrorResponse(
  { err }: { err: unknown },
  _optional: Record<string, never> = {},
): { status: number; body: Record<string, unknown> } | undefined {
  for (const [ErrorClass, mapper] of NEWSLETTER_ERROR_MAPPERS) {
    if (err instanceof ErrorClass) return mapper(err as never);
  }
  return undefined;
}
