/**
 * @file Shared vocabulary for durable form-submission delivery: bindings, the frozen job payload,
 * the adapter result, the safe error codes and the persistence port the planner writes through.
 * Kept free of behaviour so hosts and adapter ABIs can import the shapes without pulling logic.
 */
import type { DomainEvent } from "../../core/index.js";

/** Outbox event name of one child delivery job (one per selected binding per submission). */
export const FORM_DELIVERY_EVENT = "form.submission.delivery";

/** One configured destination. Credentials are never stored here, only a reference the host
 * resolves fresh on each attempt, so a rotated or revoked credential takes effect at once. */
export interface FormDeliveryBinding {
  readonly bindingId: string;
  readonly adapterId: string;
  readonly connectionRef: string;
  readonly enabled: boolean;
  /** Absent = every form; [] = no form. */
  readonly formIds?: readonly string[];
  /** Adapter-owned non-secret configuration. */
  readonly config: Readonly<Record<string, unknown>>;
}

/** One field as a destination sees it. `name` is the stable field id that keys `answers`;
 * `label`/`type` are optional so adapters written before them keep working. */
export interface FormDeliveryField {
  readonly name: string;
  readonly required: boolean;
  readonly maxLength?: number;
  readonly multiple?: true;
  readonly label?: string;
  readonly type?: string;
}
export interface FormDeliveryForm {
  readonly slug: string;
  readonly fields: readonly FormDeliveryField[];
}
/** The submission as delivered. The source IP is deliberately absent: destinations get answers only. */
export interface FormDeliverySubmission {
  readonly id: string;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly submittedAt: string;
}
export interface FormDeliverySnapshot {
  readonly form: FormDeliveryForm;
  readonly submission: FormDeliverySubmission;
}

/** Payload of one child job, frozen at planning: retries and replays never re-read settings or answers. */
export interface FormDeliveryJob {
  readonly binding: FormDeliveryBinding;
  readonly snapshot: FormDeliverySnapshot;
  /** Stable per (submissionId, bindingId); identical on every retry so destinations can dedupe. */
  readonly idempotencyKey: string;
}

/** The one plan recorded per (workspace, submission), even when no binding matched. */
export interface FormDeliveryPlan {
  readonly workspaceId: string;
  readonly submissionId: string;
  readonly formId: string;
  /** Child outbox events; their ids are generated here and never regenerated. */
  readonly jobs: readonly DomainEvent<FormDeliveryJob>[];
}

/** The only error codes that may reach the outbox ledger or a status read. */
export type FormDeliveryErrorCode =
  | "authorization-required"
  | "rate-limited"
  | "configuration-invalid"
  | "mapping-invalid"
  | "resource-not-granted"
  | "destination-limit"
  | "outcome-unknown"
  | "adapter-unavailable"
  | "delivery-failed";

/** What a push adapter may return. `void` (legacy adapters) means success. */
export type FormDeliveryResult =
  | { readonly ok: true; readonly reference?: string }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: FormDeliveryErrorCode;
        readonly retryable: boolean;
        readonly retryAfterMs?: number;
        /** `not-applied`: nothing was written. `unknown`: the write may have landed; a retry relies on the idempotency key. */
        readonly outcome?: "not-applied" | "unknown";
      };
    };

/** Host persistence for plans. */
export interface FormDeliveryPlanPort {
  /** Returns the stored plan for (workspaceId, submissionId), or runs `build` and stores its plan
   * together with ALL its child jobs in one transaction. Concurrent callers must be serialized. */
  once(
    required: { workspaceId: string; submissionId: string; build: () => Promise<FormDeliveryPlan> },
    optional?: Record<string, never>,
  ): Promise<FormDeliveryPlan>;
}
