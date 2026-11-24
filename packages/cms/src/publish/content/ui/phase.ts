import type { PublishContentExecuteResult, PublishContentPlanResult, PublishContentReport } from "./contract.js";
import { summarizePublishReport, toPublishReportRowCores } from "./report-rows.js";

/**
 * @file Task 11 — the plan -> confirm -> execute ceremony as a closed state machine.
 *
 * ## The property this file is responsible for
 *
 * Plan §4 task 11: *the dialog cannot fire execute without a confirmed plan.*
 *
 * The confirmation token only ever exists inside a `confirmed`/`executing` phase, and
 * {@link confirmationTokenFor} is the only way to read it. The admin hook calls the execute port
 * with that return value, so "no token" is not a check the hook can forget to write — there is
 * simply nothing to pass. The server enforces the same property independently
 * (`gateway.execute()` re-runs `computePlan()` and hash-compares it against the token, CIC
 * U-001-B3); this is the client half, so the operator never sees a button that would 4xx.
 *
 * `confirming` and `executing` are distinct phases from `planned`/`confirmed` rather than a
 * `busy` boolean beside them, so an in-flight request cannot be started twice by a second click —
 * the guards below are false while one is open.
 */

/** Where the ceremony currently is. Exhaustive: every transition the hook can make lands on one. */
export type PublishContentPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "planning" }
  | { readonly kind: "planned"; readonly plan: PublishContentPlanResult }
  | { readonly kind: "confirming"; readonly plan: PublishContentPlanResult }
  | { readonly kind: "confirmed"; readonly plan: PublishContentPlanResult; readonly confirmationToken: string }
  | { readonly kind: "executing"; readonly plan: PublishContentPlanResult; readonly confirmationToken: string }
  | { readonly kind: "done"; readonly result: PublishContentExecuteResult }
  | { readonly kind: "failed"; readonly message: string; readonly code: string | null };

/**
 * The execute step's only authorization, and the only way to read it.
 *
 * Returns `null` for every phase that has not completed a confirm — including `planned`, which is
 * the one an implementation is most likely to get wrong: a plan the operator has *seen* is still
 * not a plan the server has *issued a token for*.
 *
 * @complexity O(1).
 */
export function confirmationTokenFor(phase: PublishContentPhase): string | null {
  return phase.kind === "confirmed" || phase.kind === "executing" ? phase.confirmationToken : null;
}

/**
 * Whether the operator may start a run from here.
 *
 * `done` is excluded deliberately: re-running against the same dialog after a successful publish
 * would plan against state the run itself just changed, and the honest affordance is to close and
 * reopen. `failed` is included — a network error should not strand the dialog.
 *
 * @complexity O(1).
 */
export function canRequestPlan(phase: PublishContentPhase): boolean {
  return phase.kind === "idle" || phase.kind === "failed";
}

/**
 * Whether the plan currently on screen may be confirmed.
 *
 * Refuses a refused report (plan §5 risk #10: a content-hash version mismatch means this instance
 * cannot trust its own comparisons, so there is nothing safe to confirm), and refuses a plan whose
 * every row is `unchanged`/`conflict`/`blocked` — a run that would write nothing should not capture
 * a restore point and burn a change set to prove it.
 *
 * @complexity O(n) in the plan's row count, via {@link summarizePublishReport}.
 */
export function canConfirmPlan(phase: PublishContentPhase): boolean {
  if (phase.kind !== "planned") return false;
  if (phase.plan.details.refused) return false;
  return summarizePublishReport({ rows: toPublishReportRowCores({ report: phase.plan.details }) }).publishing > 0;
}

/**
 * The plan the operator is currently looking at, if any.
 *
 * Every phase from `planned` through `executing` renders the same report table — the rows do not
 * disappear while a confirm or an execute is in flight, which is the whole point of showing them.
 * `planning` deliberately returns `null`: it has no plan yet, and a caller that assumed otherwise is
 * the bug this function exists to make impossible.
 *
 * @complexity O(1).
 */
export function planOnScreen(phase: PublishContentPhase): PublishContentPlanResult | null {
  switch (phase.kind) {
    case "planned":
    case "confirming":
    case "confirmed":
    case "executing":
      return phase.plan;
    default:
      return null;
  }
}

/** The current plan before execution, the server's actual row outcomes afterwards.
 * Older peers without a result report show their completion count only.
 * @complexity O(1); no I/O. */
export function reportOnScreen({ phase }: { phase: PublishContentPhase }, _options = {}): PublishContentReport | null {
  if (phase.kind === "done") return phase.result.report ?? null;
  return planOnScreen(phase)?.details ?? null;
}
