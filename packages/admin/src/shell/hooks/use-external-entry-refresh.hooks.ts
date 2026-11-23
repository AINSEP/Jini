import { useCallback, useEffect, useRef, useState } from "react";

import { decideExternalEntryRefresh, type ExternalEntryRevision } from "../lib/external-entry-refresh.js";

import type { SettlementGeneration } from "../../react/kit.js";

/**
 * @file The stateful half of "did this row change out from under an open editor" (see
 * `lib/external-entry-refresh.ts`'s header for the pure decision rule this wraps). Each editor hook
 * (`use-page-editor.hooks.ts`, `use-post-editor.hooks.ts`) owns its own
 * `useContentRefreshSubscription({ resource: RESOURCE, onRefresh: controller.checkForExternalChange })` call — this hook does
 * NOT subscribe to the bus itself, so the `content-refresh-coverage.unit.test.ts` tripwire on each
 * editor file actually guards the wiring, rather than a shared internal subscription hiding it.
 *
 * Own `useSettlementGeneration` instance (the host supplies the hook as a required input, so this
 * module imports no default implementation), deliberately separate from the editor's own save
 * settlement: a background re-read settling while a save is in flight must not make that save think
 * it was superseded (sharing one generation counter would leave `saving` stuck `true` after a
 * background check bumped the shared generation out from under it).
 */

export interface ExternalEntryRefreshInput<Row extends ExternalEntryRevision> {
  /** The row the editor treats as its saved basis; `null` before load. */
  loaded: Row | null;
  routeIdentity: string;
  saveSettlement: number;
  /** Re-reads the row by id through the editor's own injected port. */
  fetchLatest: (input: { id: string }, options?: Record<string, never>) => Promise<Row>;
  /** Called when the fetch SETTLES — must reflect the working copy at that instant, not at the
   *  moment the fetch started. */
  isDirty: () => boolean;
  /** Called when the fetch SETTLES. */
  isSaving: () => boolean;
  /** Replace the working copy and the saved baseline with `row`. Used by both the silent apply
   *  path and Load latest. */
  applyLatest: (row: Row) => void;
  /** Load latest only — the editor's `autosave.clearStandingDraft`. */
  discardStandingDraft: () => Promise<unknown>;
  /** Both apply paths, called with the applied row's version just before `applyLatest` — the
   *  editor's `autosave.supersedeBasis`, so no autosave built on the replaced version can still be
   *  refused and pause autosaving afterwards. */
  supersedeStandingDraftBasis: (version: number) => void;
  /** Load latest only, when the re-read fails. The editor sets its own (translated) error. */
  onLoadLatestFailed: () => void;
  /** The host's settlement-generation hook. Called once per render for this hook's OWN counter —
   *  never the editor's save counter (see the file header for why they must stay separate). */
  useSettlementGeneration: () => SettlementGeneration;
}

export interface ExternalEntryRefreshController {
  /** Non-null only while a newer saved version exists AND the editor has unsaved edits the
   *  operator hasn't resolved. Derived from `loaded`, so it clears itself once the editor's own
   *  basis catches up (a Save, Save anyway, or Load latest) without a separate effect. */
  pendingExternalVersion: number | null;
  /** Fire-and-forget background check, triggered by a content-refresh notification. Stable
   *  identity across renders. While a Load latest click is in flight it is deferred and runs once
   *  that click settles, rather than superseding it. */
  checkForExternalChange: () => void;
  /** Discards the standing draft, then re-reads and applies the row, clearing any notice. */
  loadExternalChange: () => Promise<void>;
  /** Hides the notice and silences further ones until the loaded basis version moves. */
  dismissExternalChange: () => void;
}

export function useExternalEntryRefresh<Row extends ExternalEntryRevision>(
  input: ExternalEntryRefreshInput<Row>,
  _optional: Record<string, never> = {},
): ExternalEntryRefreshController {
  const { latestRef, generations, dismissedForBasisRef, notifiedVersion, setNotifiedVersion, loadInFlightRef, checkDeferredRef, notifiedRowId } = useExternalRefreshState<Row>({ input });
  const { checkForExternalChange } = useExternalRefreshCheck<Row>({ latestRef, loadInFlightRef, checkDeferredRef, generations, dismissedForBasisRef, setNotifiedVersion, notifiedRowId });
  const { loadExternalChange } = useExternalRefreshLoad<Row>({ latestRef, setNotifiedVersion, dismissedForBasisRef, generations, loadInFlightRef, checkDeferredRef, checkForExternalChange });

  useEffect(() => {
    window.addEventListener("focus", checkForExternalChange);
    return () => window.removeEventListener("focus", checkForExternalChange);
  }, [checkForExternalChange]);
  const lastSettlement = useRef({ routeIdentity: input.routeIdentity, counter: input.saveSettlement });
  useEffect(() => {
    const previous = lastSettlement.current;
    lastSettlement.current = { routeIdentity: input.routeIdentity, counter: input.saveSettlement };
    if (previous.routeIdentity !== input.routeIdentity) return;
    if (input.saveSettlement > previous.counter) checkForExternalChange();
  }, [input.routeIdentity, input.saveSettlement, checkForExternalChange]);

  const dismissExternalChange = useCallback(() => {
    dismissedForBasisRef.current = latestRef.current.loaded?.version ?? null;
    setNotifiedVersion(null);
  }, []);

  const pendingExternalVersion =
    notifiedVersion !== null && input.loaded !== null && notifiedVersion > input.loaded.version && notifiedRowId.current === input.loaded.id ? notifiedVersion : null;

  return { pendingExternalVersion, checkForExternalChange, loadExternalChange, dismissExternalChange };
}

function useExternalRefreshLoad<Row extends ExternalEntryRevision>(
  { latestRef, setNotifiedVersion, dismissedForBasisRef, generations, loadInFlightRef, checkDeferredRef, checkForExternalChange }:
    Pick<ReturnType<typeof useExternalRefreshState<Row>>, "latestRef" | "setNotifiedVersion" | "dismissedForBasisRef" | "generations" | "loadInFlightRef"
    | "checkDeferredRef"> &
    Pick<ReturnType<typeof useExternalRefreshCheck<Row>>, "checkForExternalChange">
) {
  /** Load latest's apply half, once its re-read succeeded. @complexity O(1) plus the callbacks. */
  const applyLoadedLatest = useCallback((fresh: Row) => {
    const current = latestRef.current;
    setNotifiedVersion(null);
    dismissedForBasisRef.current = null;
    // Discard first: its synchronous prefix cancels the pending autosave timer, lifts the stale-basis
    // gate and drops the local mirror before the working copy changes. That alone did not stop a
    // write on the replaced basis: a render that committed just before this one (GrapesJS syncing
    // canvas text on the click) can still run its autosave effect afterwards. The basis supersede
    // closes that, and ignores the refusal of a write already in flight.
    void current.discardStandingDraft();
    current.supersedeStandingDraftBasis(fresh.version);
    current.applyLatest(fresh);
  }, []);

  const loadExternalChange = useCallback(async () => {
    const loaded = latestRef.current.loaded;
    if (loaded === null || latestRef.current.isSaving()) return;
    const generation = generations.next();
    loadInFlightRef.current = true;
    const fresh = await latestRef.current.fetchLatest({ id: loaded.id }).then(
      (row) => row,
      () => null
    );
    // A later click (or unmount) owns the in-flight state and any deferred check now.
    if (!generations.isCurrent({ generation })) return;
    loadInFlightRef.current = false;
    if (fresh === null) {
      latestRef.current.onLoadLatestFailed();
    } else {
      applyLoadedLatest(fresh);
    }
    if (checkDeferredRef.current) {
      checkDeferredRef.current = false;
      checkForExternalChange();
    }
  }, [applyLoadedLatest, checkForExternalChange, generations]);
  return { loadExternalChange };
}

function useExternalRefreshCheck<Row extends ExternalEntryRevision>(
  { latestRef, loadInFlightRef, checkDeferredRef, generations, dismissedForBasisRef, setNotifiedVersion, notifiedRowId }:
    Pick<ReturnType<typeof useExternalRefreshState<Row>>, "latestRef" | "loadInFlightRef" | "checkDeferredRef" | "generations" | "dismissedForBasisRef"
    | "setNotifiedVersion" | "notifiedRowId">
) {
  const checkForExternalChange = useCallback(() => {
    const { loaded, routeIdentity } = latestRef.current;
    if (loaded === null) return;
    // Never supersedes a Load latest click (reviewer finding 3, 2026-09-16): with one shared
    // generation, a tool-result publish landing during the click's re-read dropped the click
    // without a word. Deferred rather than skipped, because the notification may name a write newer
    // than the row the click is fetching.
    if (loadInFlightRef.current) {
      checkDeferredRef.current = true;
      return;
    }
    const generation = generations.next();
    latestRef.current
      .fetchLatest({ id: loaded.id })
      .then((fresh) => {
        if (!generations.isCurrent({ generation })) return;
        const current = latestRef.current;
        if (current.routeIdentity !== routeIdentity || current.loaded?.id !== loaded.id) return;
        const decision = decideExternalEntryRefresh({
          loaded: current.loaded,
          fresh,
          dirty: current.isDirty(),
          saving: current.isSaving(),
          dismissedForBasisVersion: dismissedForBasisRef.current,
        });
        if (decision === "apply") {
          setNotifiedVersion(null);
          current.supersedeStandingDraftBasis(fresh.version);
          current.applyLatest(fresh);
        } else if (decision === "notify") {
          notifiedRowId.current = fresh.id;
          setNotifiedVersion(fresh.version);
        } else {
          // "ignore" — nothing to do; see this file's header for why a failed/no-op check is silent.
        }
      }, () => {
        // Best-effort background check — a failed re-read leaves the editor showing the last row
        // it knows about; the operator sees nothing wrong that isn't already true.
      });
  }, [generations]);
  return { checkForExternalChange };
}

function useExternalRefreshState<Row extends ExternalEntryRevision>(
  { input }:
    { input: ExternalEntryRefreshInput<Row> }
) {
  // Read through a ref so `checkForExternalChange`/`loadExternalChange` keep a stable identity
  // regardless of how often the editor's closures (isDirty, applyLatest, ...) change identity.
  // Updated in an effect rather than during render: this hook's reads all happen in awaited
  // continuations, after the commit's effects have flushed, so there is no child-effect ordering
  // hazard the way there is for a port a child reads inside the SAME commit (see
  // `use-assistant-chats.hooks.ts`'s `portRef` doc for that distinct case).
  const latestRef = useRef(input);
  useEffect(() => {
    latestRef.current = input;
  });

  const generations = input.useSettlementGeneration();
  const saving = input.isSaving();
  useEffect(() => {
    loadInFlightRef.current = false;
    checkDeferredRef.current = false;
    return () => {
      // A fetch that settles after unmount must not touch state on a dead hook instance.
      generations.next();
    };
  }, [generations, input.routeIdentity, input.loaded?.id, saving, input.saveSettlement]);

  const dismissedForBasisRef = useRef<number | null>(null);
  useEffect(() => { dismissedForBasisRef.current = null; }, [input.routeIdentity, input.loaded?.id]);
  const [notifiedVersion, setNotifiedVersion] = useState<number | null>(null);
  const notifiedRowId = useRef<string | null>(null);
  // True while a Load latest click waits on its re-read, and whether a check arrived meanwhile.
  const loadInFlightRef = useRef(false);
  const checkDeferredRef = useRef(false);
  return { latestRef, generations, dismissedForBasisRef, notifiedVersion, setNotifiedVersion, loadInFlightRef, checkDeferredRef, notifiedRowId };
}
