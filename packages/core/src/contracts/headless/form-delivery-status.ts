import type { FormDeliveryJobStatus } from "../site/cms-forms.js";

/**
 * @file The read port `forms_delivery_status` uses to report durable form delivery. Declared as a contract,
 * structurally, so the forms feature never imports the database layer; the site composition binds
 * `SqlFormDeliveryRepo`, whose status comes only from each delivery job's outbox row.
 */

/** One binding's delivery of one submission: status derived from its outbox job, nothing else.
 * The one definition: `SqlFormDeliveryRepo` returns it and the tool reports it. */
export type FormDeliveryStatusRow = {
  readonly bindingId: string;
  readonly adapterId: string;
  readonly formId: string;
  readonly submissionId: string;
} & FormDeliveryJobStatus;

/** Read side of durable form delivery (`SqlFormDeliveryRepo`); both reads are scoped to `workspaceId`. */
export interface FormDeliveryStatusPort {
  /** Counts only, never recipient addresses, answers, or provider exception text. */
  notificationSummary?(required: { workspaceId: string; submissionId: string }, optional?: Record<string, never>): Promise<{ failed: number; pending: number }>;
  forSubmission(required: { workspaceId: string; submissionId: string }, optional?: Record<string, never>): Promise<readonly FormDeliveryStatusRow[]>;
  recentUnfinished(required: { workspaceId: string }, optional?: { limit?: number }): Promise<readonly FormDeliveryStatusRow[]>;
}
