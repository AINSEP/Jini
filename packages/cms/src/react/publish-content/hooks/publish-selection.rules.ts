import { canConfirmPlan, type PublishContentPhase } from "../../../publish/content/ui/index.js";

/**
 * Whether `peerId` is an actually-chosen site, as opposed to the picker's blank placeholder
 * (`PublishContentDialog.tsx`'s `<option value="">`, which fires `onSelectPeer({ peerId: "" })`) or nothing
 * chosen at all. Every guard downstream of a peer id — the start gate, the confirm gate, and the
 * execute effect's gate — reads this rather than a bare `!== null`, so an empty string can never slip
 * through one of them into a `planPublish`/`confirmPublish`/`executePublish` call with an empty
 * `:peerId` segment (a confusing 404, since Express can't route an empty path segment, instead of the
 * button simply staying disabled — plan-server.md's BLOCKED-CLAIMED finding, 2026-09-20).
 * `onSelectPeer` below also normalizes `""` to `null` in {@link selectedPeerId} itself, so this
 * belongs to defense in depth for anything that reads {@link planPeerRef} after an `await`, not the
 * only thing standing between the picker and the network.
 * @complexity O(1).
 */
export function isChosenPeerId(peerId: string | null): peerId is string {
  return peerId !== null && peerId !== "";
}

/** A confirmable plan with at least one row publishing and no overwrite replan still in flight. */
export function canConfirmSelection(
  { phase, selectedPublishing, overwriteReplanPending }: { phase: PublishContentPhase; selectedPublishing: number; overwriteReplanPending: boolean },
): boolean {
  return canConfirmPlan(phase) && selectedPublishing > 0 && !overwriteReplanPending;
}

