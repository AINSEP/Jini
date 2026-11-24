import type { AccessApprovalDescription } from "../../approval.js";
import type { SurfaceDetail } from "../cards.js";

export interface HumanConfirmSpec {
  /** The calling tool's own id — the click is routed back to it, so it must be allowlisted. */
  readonly toolId: string;
  /** Fixed access changes, rendered through the common card and always approved afresh. */
  readonly access?: AccessApprovalDescription;
  /** Prefix for the refusal code when no human can be asked, e.g. `"WEBHOOKS"`. */
  readonly errorCode: string;
  readonly title: string;
  readonly description?: string;
  /** Jini renders structured JSON values, optional previous snapshots and explicit field labels. */
  readonly details: readonly SurfaceDetail[];
  readonly detailDisclosure?: { readonly label: string; readonly details: readonly SurfaceDetail[] };
  readonly warning?: string;
  /** Plain explanation in a neutral box; `warning` stays the red callout for real danger. */
  readonly notice?: string;
  /** Resource ids in `access` whose facts the card's own `details` already state: left out of the rows, never out of the approval. */
  readonly accessRowsStatedInDetails?: readonly string[];
  readonly danger?: boolean;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  /**
   * Further affirmative buttons after confirm ("Allow for this chat", say). Each one confirms exactly
   * as confirm does — same dwell, same one-call lock — and also posts its `choice`, which comes back
   * as {@link HumanConfirmOutcome}'s `choice`. A `choice` that is not one of these is ignored, so a
   * forged answer can never widen what the person was offered.
   */
  readonly alternatives?: readonly HumanConfirmAlternative[];
}

/** One extra affirmative button — see {@link HumanConfirmSpec.alternatives}. */
export interface HumanConfirmAlternative {
  /** The button's handle, a lowercase `[a-z0-9-]` id other than `confirm`/`cancel`. */
  readonly id: string;
  readonly label: string;
  /** What this button answers, reported back as the outcome's `choice`. */
  readonly choice: string;
}
