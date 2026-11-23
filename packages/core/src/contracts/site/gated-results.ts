/**
 * @file The wire envelopes shared by every 3-endpoint gated-mutation ceremony (taxonomy merge-term,
 * database migrate-forward, recovery restore, ...). Each mirrors the gated-mutations gateway's own
 * `plan`/`confirm`/`execute` shape; `GatedPlanResult`/`GatedConfirmResult` are the shared envelope,
 * `TDetails` varies per ceremony. Types only — no runtime.
 */

/** What a ceremony's `plan` endpoint returns: the plan's id and hash plus its per-ceremony details. */
export interface GatedPlanResult<TDetails = unknown> {
  planId: string;
  planHash: string;
  details: TDetails;
}

/** What a ceremony's `confirm` endpoint returns: the token its `execute` endpoint requires. */
export interface GatedConfirmResult {
  confirmationToken: string;
}
