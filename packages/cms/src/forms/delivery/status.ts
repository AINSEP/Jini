/**
 * @file Derives a binding's delivery status from its outbox row. The outbox is the only ledger;
 * keeping a second status table would let the two disagree after a crash or a manual retry.
 */
import type { OutboxRecord } from "../../core/index.js";
import { safeFormDeliveryErrorCode } from "./errors.js";
import type { FormDeliveryErrorCode } from "./types.js";

export type FormDeliveryState = "pending" | "retrying" | "completed" | "failed";
export interface FormDeliveryJobStatus {
  readonly status: FormDeliveryState;
  readonly attempts: number;
  /** Set only while a failed attempt waits for its next try. */
  readonly nextRetryAt: string | null;
  readonly errorCode: FormDeliveryErrorCode | null;
}

function stateOf(row: Pick<OutboxRecord, "status" | "attempts">): FormDeliveryState {
  if (row.status === "delivered") return "completed";
  if (row.status === "failed") return "failed";
  return row.attempts > 0 ? "retrying" : "pending";
}

/**
 * Pure projection of one outbox row. `lastError` is re-sanitised here even though delivery errors
 * are already codes, because the worker also writes its own timeout and lease messages there.
 * @example formDeliveryStatusFromOutbox({ row: { status: 'pending', attempts: 1, nextAttemptAt, lastError: 'rate-limited' } })
 */
export function formDeliveryStatusFromOutbox(
  required: { row: Pick<OutboxRecord, "status" | "attempts" | "nextAttemptAt"> & { lastError?: string | null } },
  _optional: Record<string, never> = {},
): FormDeliveryJobStatus {
  const { row } = required;
  const status = stateOf(row);
  return {
    status,
    attempts: row.attempts,
    // A `processing` row is running now; its nextAttemptAt is a lease expiry, not a retry time.
    nextRetryAt: status === "retrying" && row.status === "pending" ? row.nextAttemptAt : null,
    errorCode: status !== "completed" && row.lastError ? safeFormDeliveryErrorCode({ code: row.lastError }) : null,
  };
}
