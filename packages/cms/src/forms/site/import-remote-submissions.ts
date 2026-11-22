import type { FormPullRefusal } from "../index.js";
import type { FormImportCounts, RemoteImportResult } from "../html/index.js";

/** One destination's outcome in a pull. `error` is a person-facing reason without any key. */
export interface FormDestinationPullReport {
  readonly targetId: string;
  readonly url: string;
  readonly pulled: number;
  readonly imported: number;
  readonly duplicates: number;
  readonly acknowledged: number;
  /** More rows are waiting at the host than one pull reads. */
  readonly hasMore: boolean;
  readonly invalid: RemoteImportResult["invalid"];
  readonly skipped: RemoteImportResult["skipped"];
  readonly error?: string;
  /** Set when this receiver's pull lease refused the pull; nothing was read from it. */
  readonly refused?: FormPullRefusal;
}

/** One form's rows across a whole pull. `failed` rows were read in a page whose import stopped with
 * an error: none of that page is acknowledged, so they stay at the host and the next pull retries
 * them (rows that page committed before the error then count as already imported).
 * `formId` is null when no form with that slug exists here (its rows are `unmapped`). */
export interface FormPullCounts extends FormImportCounts {
  readonly formId: string | null;
  failed: number;
}

/** What one pull reports. `ran: false` only when every receiver's lease refused it. */
export type FormSubmissionsPullResult = {
  readonly message: string;
  readonly destinations: readonly FormDestinationPullReport[];
  readonly forms: readonly FormPullCounts[];
  readonly totals: { readonly imported: number; readonly alreadyImported: number; readonly unmapped: number; readonly failed: number };
} & ({ readonly ran: true } | { readonly ran: false; readonly reason: FormPullRefusal });

/** Pulls every published destination's pending submissions (or one target's) into this site. The
 * agent tool and the admin route both call this one composed port. */
export interface FormSubmissionsPullPort {
  pull(required: { workspaceId: string }, optional?: { targetId?: string }): Promise<FormSubmissionsPullResult>;
}

/** The automatic pull the serving app's startup and sign-in triggers run (`composeFormSubmissions`).
 * `run` resolves when the pull is done or skipped; it reports nothing. `drained` resolves once every
 * notification drain a pull (manual or automatic) started has settled, so shutdown can wait for it. */
export interface FormsAutoPullPort {
  run(required: { workspaceId: string }, optional?: Record<string, never>): Promise<void>;
  drained(required?: Record<string, never>, optional?: Record<string, never>): Promise<void>;
}
