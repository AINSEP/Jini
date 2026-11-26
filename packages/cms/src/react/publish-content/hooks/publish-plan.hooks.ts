import { isChosenPeerId } from "./publish-selection.rules.js";
import { useCallback, useRef, useState } from "react";
import type { PublishContentPeerView } from "@jini-ai/core/contracts/site/cms-publish-content";
import { overwriteReplanIsConsistent, type PublishContentPhase, type PublishContentPlanResult } from "../../../publish/content/ui/index.js";
import { publishMismatchMessage } from "./publish-confirm-view.js";
import type { usePublishPeers } from "./publish-peers.hooks.js";
import type { usePublishLifecycle } from "./publish-lifecycle.hooks.js";

export function usePublishPlanState(required: ReturnType<typeof usePublishLifecycle>, _optional = {}) {
  const { phase, onCancel } = required;
  const state = usePublishOverwriteState({});
  const { deselectedKeys, setDeselectedKeys, overwriteKeys, setOverwriteKeys, overwriteMismatch, setOverwriteMismatch, basePlanRef, basePlanStaleRef, overwriteKeysRef, overwriteReplanPendingRef, overwriteReplanPending, setReplanPending } = state;

  const dismissible = !publishInFlight(phase);
  const onDismiss = (): void => {
    if (dismissible) onCancel();
  };

  // The site the current phase's plan was requested from — what confirm and execute address, never
  // the picker's value at click time (terra review 2026-09-20, finding 2). `PublishContentPlanResult`
  // carries no peer id of its own, so the binding is kept here: set when a plan is requested, cleared
  // when the operator picks another site. A ref because `requestPlan` compares against it after an
  // `await`, where a state read would be the stale closure value.
  const planPeerRef = useRef<string | null>(null);

  return { deselectedKeys, setDeselectedKeys, overwriteKeys, setOverwriteKeys, overwriteMismatch, setOverwriteMismatch, basePlanRef, basePlanStaleRef, overwriteKeysRef, overwriteReplanPendingRef, overwriteReplanPending, setReplanPending, dismissible, onDismiss, planPeerRef };
}

export function usePublishPlan(required: ReturnType<typeof usePublishLifecycle> & ReturnType<typeof usePublishPeers> & ReturnType<typeof usePublishPlanState>, _optional = {}) {
  const { planPeerRef, setPhase, planInScope, live, basePlanRef, basePlanStaleRef, overwriteKeysRef, setOverwriteKeys, setOverwriteMismatch, setReplanPending, t, deps } = required;
  const { describeApiError } = deps;
  // Takes `peerId` explicitly rather than reading `selectedPeerId` off closure: `onConnect` below
  // calls this in the same tick it learns the newly-connected peer's id, before that `setState` has
  // committed, so a closure read here would still see `null`.
  //
  // Guards with `isChosenPeerId` itself rather than trusting every caller to check first (a3-review-4
  // handoff, 2026-09-21): `onConnect` calls this with whatever `site.id` `connectDestination` answers,
  // with no check of its own — a contract violation there would otherwise reach
  // `port.planPublish({ peerId: "" })` unguarded. This is the one function every network call in this
  // hook goes through, so the guard belongs here, not repeated (and possibly forgotten) at each caller.
  const requestPlan = useCallback(
    async (peerId: string) => {
      if (!isChosenPeerId(peerId)) return;
      planPeerRef.current = peerId;
      setPhase({ kind: "planning" });
      try {
        const plan = await planInScope({ peerId });
        // A plan answering for a site the dialog is no longer pointed at is dropped, not shown.
        if (!live.current || planPeerRef.current !== peerId) return;
        // A fresh top-level plan is the new baseline every overwrite tick gets checked against, and
        // starts with nothing ticked — same reasoning as `deselectedKeys` resetting on a re-plan.
        basePlanRef.current = plan;
        basePlanStaleRef.current = false;
        overwriteKeysRef.current = new Set();
        setOverwriteKeys(new Set());
        setOverwriteMismatch(null);
        setReplanPending(false);
        setPhase({ kind: "planned", plan });
      } catch (error) {
        if (!live.current || planPeerRef.current !== peerId) return;
        setPhase({
          kind: "failed",
          message: describeApiError({ e: error, fallback: t("Could not work out what would be published.") }),
          code: null,
        });
      }
    },
    [planInScope, setReplanPending, t]
  );

  return { requestPlan };
}

export function usePublishOverwrite(required: ReturnType<typeof usePublishLifecycle> & ReturnType<typeof usePublishPeers> & ReturnType<typeof usePublishPlanState>, _optional = {}) {
  const { planPeerRef, basePlanRef, phase, overwriteKeysRef, setOverwriteKeys, setOverwriteMismatch, basePlanStaleRef, setReplanPending, live, planInScope, peers, t } = required;

  /**
   * The core of S9's "ticking re-plans" flow. Re-plans with `nextOverwriteKeys` and puts the result
   * on screen; when it disagrees with the report the operator was looking at
   * (`overwriteReplanIsConsistent`), it adds the mismatch sentence too. A `planned` phase is the only
   * one this ever fires from — ticking is offered only while a report is up for review.
   *
   * `nextOverwriteKeys.size === 0` (the operator unticked the last box) goes straight back to
   * `basePlanRef.current` with no network call — unless a mismatch has shown that plan no longer
   * describes live, in which case live is asked again (with no keys).
   */
  const applyOverwriteKeys = useCallback(
    (nextOverwriteKeys: ReadonlySet<string>) => {
      const peerId = planPeerRef.current;
      const base = basePlanRef.current;
      if (!isChosenPeerId(peerId) || base === null || phase.kind !== "planned") return;
      const shown = phase.plan;
      // Keys ticked or unticked by this click, plus any still in flight from an earlier one: the
      // consistency check compares everything ELSE between the screen and the answer.
      const changing = new Set([...overwriteKeysRef.current, ...nextOverwriteKeys]);
      overwriteKeysRef.current = nextOverwriteKeys;
      setOverwriteKeys(nextOverwriteKeys);
      setOverwriteMismatch(null);
      const useBase = nextOverwriteKeys.size === 0 && !basePlanStaleRef.current;
      setReplanPending(!useBase);
      // Superseded by a newer tick, a peer switch, or an unmount while this was in flight.
      const isCurrentReplan = (_required: Record<string, never>, _options: Record<string, never> = {}): boolean =>
        live.current && planPeerRef.current === peerId && overwriteKeysRef.current === nextOverwriteKeys;
      void replanOverwrite({ ...required, peerId, base, shown, nextOverwriteKeys, changing, useBase, isCurrentReplan });
    },
    [peers, phase, planInScope, setReplanPending, t]
  );

  const onToggleOverwrite = useCallback(
    (key: string): void => {
      const next = new Set(overwriteKeysRef.current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      applyOverwriteKeys(next);
    },
    [applyOverwriteKeys]
  );

  return { applyOverwriteKeys, onToggleOverwrite };
}

function usePublishOverwriteState(_required: Record<string, never>, _optional = {}) {
  // Stored as what the operator UNCHECKED, not as what is checked. "All checked by default" is then
  // the empty set rather than a value that has to be seeded from the plan the moment it arrives —
  // there is no effect to forget, no window where the rows render before the seeding lands, and a
  // re-plan's new rows arrive checked without anything having to re-seed them.
  const [deselectedKeys, setDeselectedKeys] = useState<ReadonlySet<string>>(() => new Set());

  // publish-overwrite-live-plan §4/S9 — the "Overwrite on live" ticks. Kept as its own state, never
  // folded into `deselectedKeys`: unchecking a row means "don't publish this", ticking here means
  // "resolve this skip by overwriting live", and the two are independent (a ticked row is also, once
  // it turns `forced`, a selectable row that can itself still be deselected).
  const [overwriteKeys, setOverwriteKeys] = useState<ReadonlySet<string>>(() => new Set());
  // Set only when a ticking re-plan finds the live site moved since the plan the operator is looking
  // at — cleared the instant the ticked set changes again, since a fresh re-plan speaks for itself.
  const [overwriteMismatch, setOverwriteMismatch] = useState<string | null>(null);
  // The plan `requestPlan` most recently landed for the CURRENT peer, before any overwrite tick —
  // what unticking the last box goes back to without a network call. Reset alongside
  // `overwriteKeys` on every fresh plan, and marked stale (`basePlanStaleRef`) the moment a ticking
  // re-plan shows live moved since: from then on it no longer describes live, so unticking the last
  // box asks live again instead of putting an out-of-date list back on screen.
  const basePlanRef = useRef<PublishContentPlanResult | null>(null);
  const basePlanStaleRef = useRef(false);
  // The ticked set as of the MOST RECENT `applyOverwriteKeys` call, read synchronously inside that
  // call's own async continuation so a superseded tick's response never overwrites a newer one's —
  // the same shape as `planPeerRef`'s "answering for a peer we've left" guard, one level down.
  const overwriteKeysRef = useRef<ReadonlySet<string>>(new Set());
  // Whether a ticking re-plan is still out. While it is, the plan on screen is not the one the ticks
  // describe, so confirming it would publish WITHOUT the overwrite just asked for — and the late
  // re-plan would then be dropped as answering a phase that has moved on. The ref is the synchronous
  // guard `confirmPlan` reads; the state is what disables the button.
  const overwriteReplanPendingRef = useRef(false);
  const [overwriteReplanPending, setOverwriteReplanPending] = useState(false);
  const setReplanPending = useCallback((pending: boolean): void => {
    overwriteReplanPendingRef.current = pending;
    setOverwriteReplanPending(pending);
  }, []);

  return { deselectedKeys, setDeselectedKeys, overwriteKeys, setOverwriteKeys, overwriteMismatch, setOverwriteMismatch, basePlanRef, basePlanStaleRef, overwriteKeysRef, overwriteReplanPendingRef, overwriteReplanPending, setReplanPending };
}

async function replanOverwrite(required: Parameters<typeof usePublishOverwrite>[0] & {
  peerId: string; base: PublishContentPlanResult; shown: PublishContentPlanResult;
  nextOverwriteKeys: ReadonlySet<string>; changing: ReadonlySet<string>; useBase: boolean;
  isCurrentReplan: (required: Record<string, never>, optional?: Record<string, never>) => boolean;
}, _optional = {}) {
  const { peerId, base, shown, nextOverwriteKeys, changing, useBase, isCurrentReplan, planInScope, setReplanPending, basePlanStaleRef, setOverwriteMismatch, peers, t, setPhase, deps } = required;
  const { describeApiError } = deps;

        try {
          const replanned = useBase
            ? base
            : await planInScope(planScope({ peerId: peerId, overwriteKeys: nextOverwriteKeys }));
          if (!isCurrentReplan({})) return;
          setReplanPending(false);
          if (
            !useBase &&
            !overwriteReplanIsConsistent({
              shown: shown.details,
              next: replanned.details,
              tickedKeys: nextOverwriteKeys,
              changing,
            })
          ) {
            basePlanStaleRef.current = true;
            setOverwriteMismatch(publishMismatchMessage({ peers, peerId, t }));
          }
          setPhase((current) => (current.kind === "planned" ? { kind: "planned", plan: replanned } : current));
        } catch (error) {
          if (!isCurrentReplan({})) return;
          setReplanPending(false);
          setPhase({
            kind: "failed",
            message: describeApiError({ e: error, fallback: t("Could not work out what would be published.") }),
            code: null,
          });
        }

}

/**
 * Whether a publish has been committed and has no outcome yet: confirm is on its way or answered,
 * or execute is running. From here the live site finishes the run whatever this dialog does (terra
 * review 2026-09-20, finding 3), so the dialog stays open until it can say how that went.
 *
 * @complexity O(1).
 */
function publishInFlight(phase: PublishContentPhase): boolean {
  return phase.kind === "confirming" || phase.kind === "confirmed" || phase.kind === "executing";
}

/** A replan's scope: just the peer, plus the ticked overwrite keys when there are any. */
function planScope({ peerId, overwriteKeys }: { peerId: string; overwriteKeys: ReadonlySet<string> }, _options: Record<string, never> = {}): { peerId: string; overwriteEntityKeys?: string[] } {
  return overwriteKeys.size === 0 ? { peerId } : { peerId, overwriteEntityKeys: Array.from(overwriteKeys) };
}

/** A sole target is unambiguous; multiple targets still require the operator's selection. */
export function singlePublishPeerId(peers: readonly PublishContentPeerView[]): string | null {
  const [sole] = peers;
  return peers.length === 1 && sole ? sole.id : null;
}

