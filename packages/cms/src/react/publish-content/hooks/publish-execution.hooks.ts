import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { PublishPlanDriftError, canConfirmPlan, canRequestPlan, confirmationTokenFor, selectableRowKeys, type PublishContentPlanResult } from "../../../publish/content/ui/index.js";
import { primaryKindFor, publishPrimaryDisabled, publishMismatchMessage, CONFIRM_ARM_DELAY_MS } from "./publish-confirm-view.js";
import { isChosenPeerId } from "./publish-selection.rules.js";
import type { usePublishPeers, usePublishConnect } from "./publish-peers.hooks.js";
import type { usePublishLifecycle, usePublishReport } from "./publish-lifecycle.hooks.js";
import type { usePublishPlanState, usePublishPlan } from "./publish-plan.hooks.js";

export function usePublishConfirmFailure(required: ReturnType<typeof usePublishLifecycle> & ReturnType<typeof usePublishPeers> & ReturnType<typeof usePublishPlanState>, _optional = {}) {
  const { basePlanStaleRef, setOverwriteMismatch, peers, t, setPhase, deps } = required;
  const { describeApiError } = deps;
  const reportConfirmFailure = useCallback(
    ({ error, peerId }: { error: unknown; peerId: string }, _options: Record<string, never> = {}): void => {
      // The narrowed re-plan writes a different set than the one reviewed: put that plan on screen
      // with the same sentence a drifting overwrite tick gets, rather than confirming unseen rows.
      if (error instanceof PublishPlanDriftError) {
        basePlanStaleRef.current = true;
        setOverwriteMismatch(publishMismatchMessage({ peers, peerId, t }));
        setPhase({ kind: "planned", plan: error.plan });
        return;
      }
      setPhase({ kind: "failed", message: describeApiError({ e: error, fallback: t("Could not publish.") }), code: null });
    },
    [peers, t]
  );

  return { reportConfirmFailure };
}

export function usePublishPreparedPlan(required: ReturnType<typeof usePublishLifecycle> & ReturnType<typeof usePublishPeers> & ReturnType<typeof usePublishPlanState>, _optional = {}) {
  const { live, setPhase, port } = required;
  const confirmPreparedPlan = useCallback(
    async (
      { peerId, confirmed }: { peerId: string; confirmed: PublishContentPlanResult },
      _options: Record<string, never> = {}
    ): Promise<void> => {
      if (!live.current) return;
      if (!canConfirmPlan({ kind: "planned", plan: confirmed })) {
        setPhase({ kind: "planned", plan: confirmed });
        return;
      }
      const { confirmationToken } = await port.confirmPublish({
        peerId,
        planId: confirmed.planId,
        planHash: confirmed.planHash,
      });
      if (!live.current) return;
      setPhase({ kind: "confirmed", plan: confirmed, confirmationToken });
    },
    [port]
  );

  return { confirmPreparedPlan };
}

  /**
   * Confirms the plan on screen — and, when the operator unchecked rows, RE-PLANS first against a
   * bundle narrowed to what is still checked, then confirms THAT plan.
   *
   * The re-plan is what makes a deselection real. A confirmation token is bound to one plan hash, and
   * the destination applies the bundle it planned — so the only way to publish a subset is to give
   * the destination that subset to plan in the first place (`export-bundle.ts`'s
   * `selectBundleEntities`, via `push/plan`'s `selectedEntityKeys`). The alternative, carrying a
   * selection into execute for the apply loop to honour, would put the operator's exclusion behind a
   * flag a destination running an older build would silently ignore and publish everything anyway.
   *
   * A narrowed re-plan that turns out to write nothing lands back on `planned` with the narrowed
   * rows showing rather than confirming a run that would burn a restore point to do nothing.
   */
export function usePublishConfirmPlan(required: ReturnType<typeof usePublishLifecycle> & ReturnType<typeof usePublishPeers> & ReturnType<typeof usePublishPlanState> & ReturnType<typeof usePublishConfirmFailure> & ReturnType<typeof usePublishPreparedPlan>, _optional = {}) {
  const { planPeerRef, phase, overwriteReplanPendingRef, deselectedKeys, setPhase, planInScope, confirmPreparedPlan, live, reportConfirmFailure, deps } = required;
  const { toPublishReportRows, preparePublishConfirmation } = deps;
  const confirmPlan = useCallback(async () => {
    const peerId = planPeerRef.current;
    if (!isChosenPeerId(peerId) || phase.kind !== "planned") return;
    if (!canConfirmPlan(phase)) return;
    // The plan on screen is not yet the one the operator's latest tick describes.
    if (overwriteReplanPendingRef.current) return;
    const { plan } = phase;
    const planRows = toPublishReportRows({ report: plan.details });
    const selectable = selectableRowKeys({ rows: planRows });
    const keep = selectable.filter((key) => !deselectedKeys.has(key));
    if (keep.length === 0) return;
    // A carried-along media row is never selectable, so it is never in `keep` — but it still publishes
    // while a page/post using it is kept, and the narrowed re-plan carries it again. Its "Overwrite on
    // live" tick must survive with it, or that page publishes against the old live image.
    setPhase({ kind: "confirming", plan });
    try {
      // Carries `plan.overwriteEntityKeys` (already echoed onto `plan` by any ticking re-plan)
      // into this narrowing re-plan too — deselecting an unrelated row must never silently
      // drop an "Overwrite on live" tick. A ticked row the operator ALSO unchecked is not in
      // `keep`, so its key is dropped here: an overwrite of something not being published
      // would only ask live to force a row the bundle doesn't carry.
      const confirmed = await preparePublishConfirmation({ 
        plan,
        deselectedKeys,
        planPublish: (input, _options = {}) => planInScope({ peerId, ...input }),
      });
      await confirmPreparedPlan({ peerId, confirmed });
    } catch (error) {
      if (!live.current) return;
      reportConfirmFailure({ error, peerId });
    }
  }, [confirmPreparedPlan, deselectedKeys, phase, planInScope, reportConfirmFailure]);

  return { confirmPlan };
}

export function usePublishExecution(required: ReturnType<typeof usePublishLifecycle> & ReturnType<typeof usePublishPeers> & ReturnType<typeof usePublishPlanState>, _optional = {}) {
  const { phase, planPeerRef, setPhase, port, t, live, deps } = required;
  const { describeApiError } = deps;
  // The ONLY call site of `port.executePublish` in this package. Its input is whatever
  // `confirmationTokenFor` returns, which is `null` for every phase but `confirmed`/`executing` —
  // see this file's header for why the guard is shaped this way rather than as an inline check.
  const executionToken = confirmationTokenFor(phase);
  useEffect(() => {
    const peerId = planPeerRef.current;
    if (executionToken === null || phase.kind !== "confirmed" || !isChosenPeerId(peerId)) return;
    const { plan } = phase;
    setPhase({ kind: "executing", plan, confirmationToken: executionToken });
    void (async () => {
      try {
        // `plan.bundleId` travels from the plan response into the execute call — the peer refuses a
        // token presented against any bundle but the one it planned. `plan.overwriteEntityKeys` is
        // the CONFIRMED plan's own echoed value (S9) — never re-read from operator state here, so
        // execute can only ever force the exact set the confirmation token was issued for.
        const result = await port.executePublish({
          peerId,
          bundleId: plan.bundleId,
          confirmationToken: executionToken,
          ...(plan.overwriteEntityKeys && plan.overwriteEntityKeys.length > 0
            ? { overwriteEntityKeys: plan.overwriteEntityKeys }
            : {}),
        });
        if (!live.current) return;
        setPhase({ kind: "done", result });
      } catch (error) {
        if (!live.current) return;
        setPhase({ kind: "failed", message: describeApiError({ e: error, fallback: t("Could not publish.") }), code: null });
      }
    })();
  }, [executionToken, phase, port, t]);

}

export function usePublishPrimary(required: ReturnType<typeof usePublishLifecycle> & ReturnType<typeof usePublishPeers> & ReturnType<typeof usePublishPlanState> & ReturnType<typeof usePublishConnect> & ReturnType<typeof usePublishConfirmPlan> & ReturnType<typeof usePublishPlan> & ReturnType<typeof usePublishReport>, _optional = {}) {
  const { props, connectOffer, onConnect, phase, confirmPlan, selectedPeerId, requestPlan, connecting, selectedPublishing, overwriteReplanPending, deps } = required;

  const runPrimary = useCallback((): Promise<void> => {
    if (connectOffer) return onConnect();
    if (!canRequestPlan(phase)) return confirmPlan();
    return isChosenPeerId(selectedPeerId) ? requestPlan(selectedPeerId) : Promise.resolve();
  }, [confirmPlan, connectOffer, onConnect, phase, requestPlan, selectedPeerId]);

  const primaryKind = primaryKindFor({ phase: phase, connectOffer: connectOffer });
  const primaryDisabled = publishPrimaryDisabled({
    phase,
    selectedPeerId,
    connectOffer,
    connecting,
    selectedPublishing,
    overwriteReplanPending,
  });

  // When the confirm control last became clickable (appeared, or re-enabled after a tick's re-plan).
  // A layout effect, so the stamp lands before the browser can deliver a click to the new control.
  const confirmArmDelayMs = props.confirmArmDelayMs ?? CONFIRM_ARM_DELAY_MS;
  const confirmClickable = primaryKind === "confirm" && !primaryDisabled;
  const confirmClickableSinceRef = useRef(0);
  useLayoutEffect(() => {
    if (confirmClickable) confirmClickableSinceRef.current = deps.now();
  }, [confirmClickable]);

  // Synchronous duplicate-submit guard (terra review 2026-09-20, finding 5's sibling). The button's
  // `disabled` is render-time phase; two calls in one tick both see `planned`, and each confirmed
  // phase would fire its own execute at the live site. Held until the step's own request settles.
  const primaryInFlightRef = useRef(false);
  const onPrimary = useCallback(() => {
    if (primaryKind === "confirm" && deps.now() - confirmClickableSinceRef.current < confirmArmDelayMs) return;
    if (primaryInFlightRef.current) return;
    primaryInFlightRef.current = true;
    void runPrimary().finally(() => {
      primaryInFlightRef.current = false;
    });
  }, [confirmArmDelayMs, primaryKind, runPrimary]);

  return { primaryKind, primaryDisabled, onPrimary };
}

