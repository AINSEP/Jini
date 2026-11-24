/**
 * @file The slice of a durable run attempt that run-start decisions read. A host's durable-run
 * store (chat's `DurableRun`, a product's own row type) satisfies it structurally, so the daemon
 * decides who owns an answer without importing any store's type.
 */

/** The fields of a durable attempt the "does it still own its answer" check reads. */
export interface DurableAttemptStatus {
  /** Why the attempt was cancelled; a non-empty value means a stop took over. */
  readonly cancelReason: string | null;
  readonly message: { readonly runStatus?: string | undefined };
}
