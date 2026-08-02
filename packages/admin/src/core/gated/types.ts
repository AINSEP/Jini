/**
 * @file The plan -> confirm -> execute protocol for destructive operations.
 *
 * ## Why this is in core rather than in the panels that use it
 *
 * Tovu independently grew this same three-step shape in three unrelated places — database
 * forward-migration (`planMigrateForward`/`confirmMigrateForward`/`executeMigrateForward`),
 * point-in-time restore (`planRestore`/`confirmRestore`/`executeRestore`), and taxonomy term
 * merge (`planMergeTerm`/`confirmMergeTerm`/`executeMergeTerm`) — sharing `GatedPlanResult<T>`
 * and `GatedConfirmResult` types. Three independent arrivals at one shape is the signal that it
 * is a protocol, not a coincidence, and any product doing irreversible operator actions will
 * need it.
 *
 * ## What the three steps are for
 *
 * - **plan** is read-only and idempotent. It computes what *would* happen and returns a token.
 *   Safe to call on render; safe to call twice.
 * - **confirm** records that the operator saw the plan. Separate from execute so the UI can show
 *   consequences the operator has to acknowledge, and so a stale plan (the world changed between
 *   plan and execute) can be rejected here rather than half-applied.
 * - **execute** does the thing. Requires the token from confirm.
 *
 * The token is what makes this more than a confirmation dialog: it binds the execute call to a
 * specific computed plan, so an operator cannot approve a small change and have a large one run.
 *
 * ## Warning: this protocol promises reversibility it cannot itself deliver
 *
 * A hard-won rule from Tovu's admin UX audit: **never promise an undo the product cannot
 * deliver.** A `reversible: true` plan means the *backend* claims a revert path exists — it does
 * not mean the admin has a reachable UI for it. Tovu's post/page delete is a genuine server-side
 * soft delete with no restore path reachable from the admin. A panel rendering "you can undo
 * this" off this flag alone would be lying to the operator. Check that the revert is reachable,
 * not merely that it exists.
 */

/** What `plan` returns: the computed consequences, plus the token that binds them to `execute`. */
export interface GatedPlanResult<TDetails = unknown> {
  /** Opaque; pass back to `confirm`. Panels must not parse or construct these. */
  readonly token: string;
  /** Operation-specific description of what would happen — row counts, affected ids, warnings. */
  readonly details: TDetails;
  /** Whether the backend has a revert path. **Not** a claim that the admin exposes one — see the
   *  file header. */
  readonly reversible?: boolean;
  /** Operator-facing consequences to display before confirming. Rendered as-is; the backend owns
   *  the wording because it is the only side that knows the actual scope. */
  readonly warnings?: readonly string[];
}

/** What `confirm` returns: the token `execute` requires. */
export interface GatedConfirmResult {
  /** Distinct from the plan token. A backend may return the same value, but panels must pass
   *  through whatever they were given rather than reusing the plan's. */
  readonly confirmToken: string;
}

/**
 * A gated operation, as a panel sees it.
 *
 * Route groups implementing this get a consistent three-call shape, which is what lets a shared
 * confirmation component drive any of them without knowing the operation.
 *
 * ## Why `confirm`/`execute` take a type parameter rather than a bare token
 *
 * The first draft of this interface declared `confirm(token: string)` and
 * `execute(confirmToken: string)`, inferred from method names alone. Reading the actual reference
 * signatures showed that only one of the three real triads fits that shape:
 *
 * - **migrate-forward** — confirm and execute each take only the token. Fits.
 * - **restore** — `confirm` needs `{planId, planHash, disclosureAcknowledged}` and `execute` needs
 *   `{confirmationToken, restorePointId}`. Does not fit.
 *
 * The instructive one is restore's `disclosureAcknowledged`. It says this protocol is not merely a
 * two-step token handshake, it is *recorded informed consent* — the operator was shown what would
 * be lost and said yes. That is the most destructive operation in the product, so an interface that
 * excludes it is describing the easy case and abandoning the one that matters. Widened rather than
 * documented around.
 *
 * The extra parameters default to `string`, so the simple case still reads
 * `GatedOperation<PlanInput, Details, Result>` with no change.
 */
export interface GatedOperation<
  TPlanInput,
  TDetails,
  TResult,
  TConfirmInput = string,
  TExecuteInput = string,
> {
  plan(input: TPlanInput): Promise<GatedPlanResult<TDetails>>;
  /** Takes the plan's `token`, either bare or as one field of an operation-specific object. */
  confirm(input: TConfirmInput): Promise<GatedConfirmResult>;
  /** Takes the confirm step's `confirmToken`, bare or within an operation-specific object. */
  execute(input: TExecuteInput): Promise<TResult>;
}
