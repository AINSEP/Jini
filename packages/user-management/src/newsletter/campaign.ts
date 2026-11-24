/**
 * @file `transitionCampaignStatus` — the campaign status-machine guard (ADR-PIPE-011 C-008,
 * behavior.spec.md §1.1, REQ-04/05/07/18).
 *
 * `[internal-invariant]`: a divergence between this function and any route-layer re-implementation
 * of the transition-authority rule is a fail-open authorization bug, same class as SPEC-007's
 * `deriveRequiredPermission` (ADR-PIPE-011 Contract Map C-008). `campaign-write-service.ts` calls
 * this before every status-affecting write; no other call site may re-implement it.
 *
 * Precedence (highest to lowest — behavior.spec.md §1.1's transition-authority table):
 * 1. `pipeline` tier (the send pipeline's own internal actions, never a direct HTTP caller) —
 *    the ONLY actor that may set `scheduled -> sending` or `sending -> sent`.
 * 2. `send` tier (`admin.newsletter.campaign.send`) — may set `sending <-> paused` only (via
 *    `PAUSE_CAMPAIGN`/`RESUME_CAMPAIGN`); never sets `sending`/`sent` directly (those stay
 *    pipeline-only, reached only by triggering `authorizeSend`, which runs as `pipeline` tier).
 * 3. `schedule` tier (`admin.newsletter.campaign.schedule`) — may set `draft -> scheduled` only
 *    (via `SCHEDULE_CAMPAIGN`).
 * 4. `compose` tier (`admin.newsletter.campaign.compose`) — may set `draft -> canceled` or
 *    `scheduled -> canceled` only (via `CANCEL_CAMPAIGN`); `UPDATE_CAMPAIGN`'s body schema does not
 *    accept a `status` field at all (no direct status transition from plain field edits).
 *
 * DEVIATION DISCLOSED: `api.spec.md` has no dedicated "unschedule"/revert-to-draft endpoint in its
 * 19-route list — only `CANCEL_CAMPAIGN`/`SCHEDULE_CAMPAIGN`/`SEND_CAMPAIGN`/`SEND_TEST_CAMPAIGN`/
 * `PAUSE_CAMPAIGN`/`RESUME_CAMPAIGN` exist. This implementation therefore maps each real endpoint to
 * exactly one transition family and does NOT implement a `scheduled -> draft` transition for any
 * tier (there is no endpoint that would call it). If a future endpoint needs that transition, add it
 * here explicitly rather than widening `compose`'s existing grant.
 */
import type { CampaignStatus } from "./types.js";

export type CampaignActorTier = "pipeline" | "send" | "schedule" | "compose";

export type TransitionResult = { allowed: true } | { allowed: false; reason: string };

/**
 * Who may perform each edge, one named grant per rule below. Named rather than inlined into a
 * boolean chain so that widening a grant is a one-line, greppable change to a list, and so the
 * grant sits next to the denial text that explains it — the two drifting apart is how a fail-open
 * authorization bug reads to a reviewer.
 */
const PIPELINE_ONLY: readonly CampaignActorTier[] = ["pipeline"];
const SEND_OR_PIPELINE: readonly CampaignActorTier[] = ["send", "pipeline"];
const SCHEDULE_ONLY: readonly CampaignActorTier[] = ["schedule"];
const COMPOSE_ONLY: readonly CampaignActorTier[] = ["compose"];

/**
 * Allows an already-matched edge when the actor holds a permitted tier, else denies it with the
 * rule's own explanatory text.
 *
 * @complexity O(t) in the (fixed, ≤4) size of `permitted`.
 */
function requireTier({ actorTier, permitted, reason }: { actorTier: CampaignActorTier; permitted: readonly CampaignActorTier[]; reason: string }, _options = {}): TransitionResult {
  if (!permitted.includes(actorTier)) return { allowed: false, reason };
  return { allowed: true };
}

/**
 * The initial send start. NOTE: `paused -> sending` (resume) is a DIFFERENT edge, matched by
 * {@link isPauseOrResume} below — it must not be folded into this one by relaxing the `from` check
 * to a blanket `to === "sending"`, which would hand the resume path to the pipeline tier alone.
 */
function isSendStart(from: CampaignStatus, to: CampaignStatus): boolean {
  return from === "scheduled" && to === "sending";
}

/**
 * Admin-triggered pause/resume via `PAUSE_CAMPAIGN`/`RESUME_CAMPAIGN`. Resume CONTINUES a send the
 * pipeline already started, which is why it is grouped with the send tier rather than treated as a
 * second way to reach `sending`.
 */
function isPauseOrResume(from: CampaignStatus, to: CampaignStatus): boolean {
  return (from === "sending" && to === "paused") || (from === "paused" && to === "sending");
}

/** `SCHEDULE_CAMPAIGN`'s only edge. */
function isScheduling(from: CampaignStatus, to: CampaignStatus): boolean {
  return from === "draft" && to === "scheduled";
}

/** `CANCEL_CAMPAIGN`'s edges — a campaign is cancellable only before the send pipeline touches it. */
function isCancellation(from: CampaignStatus, to: CampaignStatus): boolean {
  return to === "canceled" && (from === "draft" || from === "scheduled");
}

/**
 * Drain completion. The only rule with two distinct denials, because `sent` is guarded on both the
 * actor (pipeline-only) and the origin state (`sending` only), and a caller needs to know which of
 * the two it tripped.
 *
 * @complexity O(1).
 */
function authorizeSendCompletion(from: CampaignStatus, actorTier: CampaignActorTier): TransitionResult {
  if (actorTier !== "pipeline") {
    return { allowed: false, reason: "only the send pipeline may set status to 'sent'" };
  }
  if (from !== "sending") {
    return { allowed: false, reason: "'sent' may only be entered from 'sending'" };
  }
  return { allowed: true };
}

/**
 * Decides whether `actorTier` may move a campaign from `from` to `to`.
 *
 * Deny-by-default: an edge no rule below matches falls through to the closing rejection, so adding
 * a status to `CampaignStatus` cannot silently open a transition. The rules are ordered, not
 * independent — `to === "sent"` deliberately sits between the send-start and pause/resume rules
 * (see this file's header for the full precedence table).
 *
 * @complexity O(1), pure, total function (every input produces a result, never throws).
 * @overallScore 100
 */
export function transitionCampaignStatus(input: {
  from: CampaignStatus;
  to: CampaignStatus;
  actorTier: CampaignActorTier;
}, _optional: Record<string, never> = {}): TransitionResult {
  const { from, to, actorTier } = input;

  if (from === to) {
    return { allowed: false, reason: `'${from}' -> '${to}' is not a transition (no-op)` };
  }
  if (isSendStart(from, to)) {
    return requireTier({ actorTier, permitted: PIPELINE_ONLY, reason: "only the send pipeline may set status to 'sending'" });
  }
  if (to === "sent") {
    return authorizeSendCompletion(from, actorTier);
  }
  if (isPauseOrResume(from, to)) {
    return requireTier({ actorTier, permitted: SEND_OR_PIPELINE, reason: `only 'admin.newsletter.campaign.send' may transition '${from}' -> '${to}'` });
  }
  if (isScheduling(from, to)) {
    return requireTier({ actorTier, permitted: SCHEDULE_ONLY, reason: "only 'admin.newsletter.campaign.schedule' may set draft -> scheduled" });
  }
  if (isCancellation(from, to)) {
    return requireTier({ actorTier, permitted: COMPOSE_ONLY, reason: "only 'admin.newsletter.campaign.compose' may cancel a campaign" });
  }

  return { allowed: false, reason: `'${from}' -> '${to}' is not a permitted transition for any actor tier` };
}
