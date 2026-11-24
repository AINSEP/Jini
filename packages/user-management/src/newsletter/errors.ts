/**
 * @file Typed domain errors for `newsletter` (SPEC-011 errors.spec.md §2).
 *
 * Purpose:
 * One class per error this module originates, mirroring the
 * `DefinitionNotFoundError`/`ForbiddenError` convention in `Jini packages/core/src/settings/errors.ts` and
 * the host members feature's error-class pattern. Route handlers map these 1:1 to the HTTP codes in
 * errors.spec.md §2 (see the host admin HTTP newsletter error-mapping helper).
 */

export class NewsletterCampaignNotFoundError extends Error {}
export class NewsletterListNotFoundError extends Error {}
export class NewsletterSubscriptionNotFoundError extends Error {}

/** errors.spec.md §3: `{ subscriberId: uuid }`. */
export class NewsletterSubscriberNotFoundError extends Error {
  public readonly subscriberId: string;
  constructor(
    { message, subscriberId }: { message: string; subscriberId: string }
  ) {
    super(message);
    this.subscriberId = subscriberId;
  }
}

/** errors.spec.md §3: `{ field: string, reason: string }`. */
export class NewsletterValidationError extends Error {
  public readonly field: string;
  public readonly reason: string;
  constructor(
    { message, field, reason }: { message: string; field: string; reason: string }
  ) {
    super(message);
    this.field = field;
    this.reason = reason;
  }
}

/** errors.spec.md §3: `{ currentStatus, attemptedAction }`. */
export class NewsletterCampaignNotEditableError extends Error {
  public readonly currentStatus: string;
  public readonly attemptedAction: string;
  constructor(
    { message, currentStatus, attemptedAction }: { message: string; currentStatus: string; attemptedAction: string }
  ) {
    super(message);
    this.currentStatus = currentStatus;
    this.attemptedAction = attemptedAction;
  }
}

/** errors.spec.md §3: `{ listId: uuid }`. */
export class NewsletterDefaultListProtectedError extends Error {
  public readonly listId: string;
  constructor(
    { message, listId }: { message: string; listId: string }
  ) {
    super(message);
    this.listId = listId;
  }
}

/** errors.spec.md §3: `{ entity, id, expectedVersion, actualVersion }` (EC-06 optimistic concurrency). */
export class NewsletterConflictError extends Error {
  public readonly entity: "campaign" | "list" | "subscription";
  public readonly id: string;
  public readonly expectedVersion: number;
  public readonly actualVersion: number;
  constructor(
    { message, entity, id, expectedVersion, actualVersion }: { message: string; entity: "campaign" | "list" | "subscription"; id: string; expectedVersion: number; actualVersion: number }
  ) {
    super(message);
    this.entity = entity;
    this.id = id;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

/** errors.spec.md §3: `{ unmetPreconditions: string[] }` — INV-05, always the FULL unmet set. */
export class NewsletterLaunchGateBlockedError extends Error {
  public readonly unmetPreconditions: readonly string[];
  constructor(
    { message, unmetPreconditions }: { message: string; unmetPreconditions: readonly string[] }
  ) {
    super(message);
    this.unmetPreconditions = unmetPreconditions;
  }
}

/** errors.spec.md §3: `{ reason: 'expired'|'already_consumed'|'not_found' }`. */
export class NewsletterConfirmTokenInvalidError extends Error {
  public readonly reason: "expired" | "already_consumed" | "not_found";
  constructor(
    { message, reason }: { message: string; reason: "expired" | "already_consumed" | "not_found" }
  ) {
    super(message);
    this.reason = reason;
  }
}

/** errors.spec.md §3: `{ reason: 'consent_revision_mismatch'|'signature_invalid'|'expired'|'not_found' }` (INV-04). */
export class NewsletterUnsubscribeTokenInvalidError extends Error {
  public readonly reason: "consent_revision_mismatch" | "signature_invalid" | "expired" | "not_found";
  constructor(
    { message, reason }: { message: string; reason: "consent_revision_mismatch" | "signature_invalid" | "expired" | "not_found" }
  ) {
    super(message);
    this.reason = reason;
  }
}

/** Fail-closed authorization error — mirrors `settings/errors.ts`'s `ForbiddenError`. */
export class NewsletterForbiddenError extends Error {}
