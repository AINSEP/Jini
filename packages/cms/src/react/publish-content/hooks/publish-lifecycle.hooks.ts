import { useCallback, useEffect, useRef, useState } from "react";
import { type CriteriaSelection, type PublishContentPhase } from "../../../publish/content/ui/index.js";
import { buildCriteriaPublishResult } from "./criteria-publish-result.js";
import type { usePublishContentConfirm } from "./use-publish-content-confirm.hooks.js";
import { peerSelectionOpen, publishReportSelection, publishOverwriteSelection, publishOverwriteNotices } from "./publish-confirm-view.js";
import { isChosenPeerId } from "./publish-plan.hooks.js";
import type { usePublishPeers } from "./publish-peers.hooks.js";
import type { usePublishPlanState, usePublishPlan, usePublishOverwrite } from "./publish-plan.hooks.js";

export function usePublishLifecycle(props: Parameters<typeof usePublishContentConfirm>[0], _optional = {}) {
  const { onCancel, t } = props;
  const port = props.port;
  const { deps } = props;
  const locale = props.hooks.useLocaleHook();

  // plan-publish-sections-2026-09-25.md §2 S2 — the ONE place `scope` reaches `port.planPublish`
  // from, so no bare `port.planPublish` call under this hook can forget it. `props.scope` is fixed
  // for the dialog's whole lifetime (it is not operator-changeable state), so this needs no memo
  // beyond `useCallback`'s own identity stability.
  const planInScope = useCallback(
    (input: { peerId: string; selectedEntityKeys?: readonly string[]; overwriteEntityKeys?: readonly string[] }) =>
      port.planPublish(props.scope === undefined ? input : { ...input, scope: props.scope }),
    [port, props.scope]
  );

  // `live` guards every `setState` that follows an `await`: the dialog is unmounted by its own
  // Cancel button and by Escape, either of which can land while a plan or a publish is in flight.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const [phase, setPhase] = useState<PublishContentPhase>({ kind: "idle" });

  return { props, onCancel, t, port, locale, deps, planInScope, live, phase, setPhase };
}

export function usePublishReport(required: ReturnType<typeof usePublishLifecycle> & ReturnType<typeof usePublishPeers> & ReturnType<typeof usePublishPlanState> & ReturnType<typeof usePublishOverwrite>, _optional = {}) {
  const { phase, locale, t, deselectedKeys, overwriteKeys, applyOverwriteKeys, peers, selectedPeerId, deps } = required;

  const {
    visiblePlan,
    rows,
    summary,
    listedRows,
    upToDateRows,
    liveGapNotices,
    selectableKeys,
    selectedKeys,
    selectedPublishing,
    carriedAlongKeys,
    allSelected,
    someSelected,
  } = publishReportSelection({ phase, locale, t, deselectedKeys, deps });
  const [upToDateExpanded, setUpToDateExpanded] = useState(false);
  const onToggleUpToDate = useCallback(() => setUpToDateExpanded((open) => !open), []);

  const {
    liveCanOverwrite,
    overwritableRows,
    overwriteOfferKeys,
    showOverwriteColumn,
    allOverwriteTicked,
    someOverwriteTicked,
  } = publishOverwriteSelection({ visiblePlan, rows, overwriteKeys });
  // Ticks every offered row — earlier ticks included — or clears them all when every one already is.
  const onToggleAllOverwrite = (): void => {
    applyOverwriteKeys(allOverwriteTicked ? new Set() : new Set(overwriteOfferKeys));
  };
  const currentPeerLabel = peers.find((peer) => peer.id === selectedPeerId)?.label ?? t("the live site");

  return { visiblePlan, rows, summary, listedRows, upToDateRows, liveGapNotices, selectableKeys, selectedKeys, selectedPublishing, carriedAlongKeys, allSelected, someSelected, upToDateExpanded, onToggleUpToDate, liveCanOverwrite, overwritableRows, overwriteOfferKeys, showOverwriteColumn, allOverwriteTicked, someOverwriteTicked, onToggleAllOverwrite, currentPeerLabel };
}

export function usePublishCriteria(required: ReturnType<typeof usePublishLifecycle> & ReturnType<typeof usePublishPeers> & ReturnType<typeof usePublishPlanState> & ReturnType<typeof usePublishPlan> & ReturnType<typeof usePublishOverwrite> & ReturnType<typeof usePublishReport>, _optional = {}) {
  const refs = usePublishCriteriaRefs(required);
  usePublishCriteriaAutoPlan({ ...required, ...refs });
  usePublishCriteriaApplication({ ...required, ...refs });
  usePublishCriteriaReport({ ...required, ...refs });
}

function usePublishCriteriaAutoPlan(required: Parameters<typeof usePublishCriteriaRefs>[0] & ReturnType<typeof usePublishCriteriaRefs>, _optional = {}) {
  const { props, phase, selectedPeerId, requestPlan, criteriaAutoPlanRef } = required;

  useEffect(() => {
    if (props.criteria === undefined || criteriaAutoPlanRef.current) return;
    if (phase.kind !== "idle" || !isChosenPeerId(selectedPeerId)) return;
    criteriaAutoPlanRef.current = true;
    void requestPlan(selectedPeerId);
  }, [props.criteria, selectedPeerId, phase, requestPlan]);
}

function usePublishCriteriaApplication(required: Parameters<typeof usePublishCriteriaRefs>[0] & ReturnType<typeof usePublishCriteriaRefs>, _optional = {}) {
  const { phase, setDeselectedKeys, criteriaAppliedRef, criteriaSelectionRef, criteriaAwaitingReplanRef, criteriaInputs, deps } = required;
  const { applyPublishCriteria, toPublishReportRows } = deps;
  useEffect(() => {
    const { criteria, applyOverwriteKeys } = criteriaInputs.current;
    if (criteria === undefined || criteriaAppliedRef.current || phase.kind !== "planned") return;
    criteriaAppliedRef.current = true;
    const sel = applyPublishCriteria({ rows: toPublishReportRows({ report: phase.plan.details }), criteria });
    criteriaSelectionRef.current = sel;
    setDeselectedKeys(sel.deselectedKeys);
    if (sel.overwriteKeys.size > 0) {
      criteriaAwaitingReplanRef.current = true;
      applyOverwriteKeys(sel.overwriteKeys);
    }
    // `applyOverwriteKeys`/`props.criteria` deliberately excluded: this must run against the render
    // where `phase` FIRST becomes "planned" (so `applyOverwriteKeys`'s own `phase.kind==="planned"`
    // guard is current, not stale — see this block's own header), and it self-guards with the ref
    // against ever running a second time regardless of what else changes identity around it.
  }, [phase]);
}

function usePublishCriteriaReport(required: Parameters<typeof usePublishCriteriaRefs>[0] & ReturnType<typeof usePublishCriteriaRefs>, _optional = {}) {
  const { phase, overwriteReplanPendingRef, rows, criteriaSelectionRef, criteriaAwaitingReplanRef, planReportInputs } = required;

  useEffect(() => {
    const { onPlanned, peers, selectedPeerId } = planReportInputs.current;
    const sel = criteriaSelectionRef.current;
    if (sel === null || phase.kind !== "planned" || onPlanned === undefined) return;
    if (criteriaAwaitingReplanRef.current) {
      // The real (not stale-closure) current value — see this file's header on why `requestPlan`
      // can't read `phase` this way but a ref always can.
      if (overwriteReplanPendingRef.current) return;
      criteriaAwaitingReplanRef.current = false;
    }
    criteriaSelectionRef.current = null;
    const siteLabel = peers.find((peer) => peer.id === selectedPeerId)?.label ?? null;
    onPlanned(buildCriteriaPublishResult({ rows: rows, selection: sel, siteLabel: siteLabel, nextStep: "Check the list in the Publish dialog, then click Publish." }));
  }, [phase, rows]);
}

function usePublishCriteriaRefs(required: ReturnType<typeof usePublishLifecycle> & ReturnType<typeof usePublishPeers> & ReturnType<typeof usePublishPlanState> & ReturnType<typeof usePublishPlan> & ReturnType<typeof usePublishOverwrite> & ReturnType<typeof usePublishReport>, _optional = {}) {
  const { props, applyOverwriteKeys, peers, selectedPeerId } = required;

  // --- S2 (publish-criteria-tool-webmcp-plan-2026-09-24.md §4) — applying `props.criteria` as the
  // dialog's STARTING selection, for a caller with no button of its own to click. Three refs, because
  // this happens at most once per mount and each step waits on the one before it settling:
  //   1. `criteriaAutoPlanRef` — plans automatically once a site is resolved, standing in for the
  //      click a person would otherwise make first (planning writes nothing, so this is safe to do
  //      unprompted — the gate in plan §3 is about confirm/execute, never about a read-only plan).
  //   2. `criteriaAppliedRef` — applies the criteria's selection/overwrite ticks against that FIRST
  //      plan and only that one; a later re-plan (a peer switch, a hand tick) is left alone.
  //   3. `criteriaAwaitingReplanRef` — set only when the criteria ticked something, so `onPlanned`
  //      waits for that re-plan's real `forced` rows instead of reporting the pre-overwrite skips.
  const criteriaAutoPlanRef = useRef(false);
  const criteriaAppliedRef = useRef(false);
  const criteriaSelectionRef = useRef<CriteriaSelection | null>(null);
  const criteriaAwaitingReplanRef = useRef(false);
  const criteriaInputs = useRef({ criteria: props.criteria, applyOverwriteKeys });
  criteriaInputs.current = { criteria: props.criteria, applyOverwriteKeys };
  const planReportInputs = useRef({ onPlanned: props.onPlanned, peers, selectedPeerId });
  planReportInputs.current = { onPlanned: props.onPlanned, peers, selectedPeerId };

  return { criteriaAutoPlanRef, criteriaAppliedRef, criteriaSelectionRef, criteriaAwaitingReplanRef, criteriaInputs, planReportInputs };
}

export function usePublishSelection(required: ReturnType<typeof usePublishLifecycle> & ReturnType<typeof usePublishPeers> & ReturnType<typeof usePublishPlanState> & ReturnType<typeof usePublishReport>, _optional = {}) {
  const { liveCanOverwrite, overwriteKeys, overwritableRows, currentPeerLabel, t, phase, setDeselectedKeys, selectedKeys, selectableKeys, deps } = required;

  const { overwriteWarning, overwriteUnavailable } = publishOverwriteNotices({
    liveCanOverwrite,
    overwriteKeys,
    overwritableRows,
    currentPeerLabel,
    t,
    deps,
  });

  // Checkboxes are an offer, and the offer closes the moment the operator commits: `planned` is the
  // only phase where changing the selection could still change what gets published.
  const selectionEnabled = phase.kind === "planned";

  const onToggleRow = ({ key }: { key: string }, _options: Record<string, never> = {}): void => {
    setDeselectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // "Any checked -> uncheck everything", so the header is an escape hatch from a big plan rather
  // than a toggle whose meaning flips at an invisible halfway point.
  const onToggleAll = (): void => {
    setDeselectedKeys(selectedKeys.size > 0 ? new Set(selectableKeys) : new Set());
  };

  const { peerSelectionEnabled, onSelectPeer } = publishPeerSelection(required);

  return { overwriteWarning, overwriteUnavailable, selectionEnabled, onToggleRow, onToggleAll, peerSelectionEnabled, onSelectPeer };
}

function publishPeerSelection(required: Parameters<typeof usePublishSelection>[0], _optional = {}) {
  const { phase, selectedPeerId, setSelectedPeerId, planPeerRef, setPhase, setDeselectedKeys, basePlanRef, basePlanStaleRef, setReplanPending, overwriteKeysRef, setOverwriteKeys, setOverwriteMismatch } = required;
  const peerSelectionEnabled = peerSelectionOpen(phase);
  const onSelectPeer = ({ peerId }: { peerId: string }, _options: Record<string, never> = {}): void => {
    // The picker's blank "Choose a site…" option fires this with `""` (its `value`) — normalized to
    // `null` here so `selectedPeerId` can never hold it, the same "nothing chosen" state a fresh
    // dialog starts in. This is the fix, not just a defense: every downstream guard reads
    // `selectedPeerId`/`planPeerRef` off THIS state, so keeping it out from the start is what makes
    // `isChosenPeerId`'s other call sites redundant-but-safe rather than load-bearing on their own.
    const normalized = peerId === "" ? null : peerId;
    if (!peerSelectionEnabled || normalized === selectedPeerId) return;
    setSelectedPeerId(normalized);
    // The report on screen, and the rows unchecked in it, describe the site being left.
    planPeerRef.current = null;
    setPhase({ kind: "idle" });
    setDeselectedKeys(new Set());
    basePlanRef.current = null;
    basePlanStaleRef.current = false;
    setReplanPending(false);
    overwriteKeysRef.current = new Set();
    setOverwriteKeys(new Set());
    setOverwriteMismatch(null);
  };

  return { peerSelectionEnabled, onSelectPeer };
}
