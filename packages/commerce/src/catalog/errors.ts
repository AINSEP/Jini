/**
 * @file Typed domain errors for `commerce`. Mirrors the `features/forms/errors.ts` /
 * `PostConflictError`-style convention already used throughout this codebase — one class per
 * error this module originates.
 */

/** The referenced product does not exist (or is not visible) in this workspace. */
export class CommerceProductNotFoundError extends Error {}

/** The referenced price does not exist in this workspace, or is not `status: "active"`. */
export class CommercePriceNotFoundError extends Error {}

/** The referenced order does not exist in this workspace. */
export class CommerceOrderNotFoundError extends Error {}

/** Another product in the workspace already holds this slug (`commerce_products_workspace_slug_unique`). */
export class CommerceProductSlugConflictError extends Error {
  readonly slug: string;
  constructor({ message, slug }: { message: string; slug: string }, _optional: Record<string, never> = {}) {
    super(message);
    this.slug = slug;
  }
}

/** Checkout input failed validation before any row was written. */
export class CommerceCheckoutValidationError extends Error {
  readonly fieldErrors: Array<{ field: string; reason: string }>;
  constructor({ message, fieldErrors = [] }: { message: string; fieldErrors?: Array<{ field: string; reason: string }> | undefined }, _optional: Record<string, never> = {}) {
    super(message);
    this.fieldErrors = fieldErrors;
  }
}
