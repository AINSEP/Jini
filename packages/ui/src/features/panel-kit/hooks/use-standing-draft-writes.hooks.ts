import { useCallback, useEffect } from "react";
import type { StandingDraftAutosaveOptions, StandingDraftAutosaveInput, StandingDraftAutosavePort } from "./use-standing-draft-autosave.hooks.js";
import type { useStandingDraftState, useStandingDraftTimer, useStandingDraftQueue } from "./use-standing-draft-state.hooks.js";
import type { useStandingDraftStaleBasis, useStandingDraftFailedSave } from "./use-standing-draft-recovery.hooks.js";

/** Idle debounce: fires this long after the LAST `scheduleAutosave` call with no further calls. */
const IDLE_DEBOUNCE_MS = 3000;
/** Hard ceiling while continuously typing: once this much time has passed since the first
 *  unflushed edit, the next tick fires immediately instead of resetting the idle window again. */
const MAX_WAIT_MS = 15000;

export function useStandingDraftWriter(state: ReturnType<typeof useStandingDraftState>, deps: StandingDraftAutosaveOptions, actions: ReturnType<typeof useStandingDraftStaleBasis> & { enqueue: ReturnType<typeof useStandingDraftQueue>; preserveFailedSave: ReturnType<typeof useStandingDraftFailedSave> }) {
  const { backupGenerationRef, latestDraftRef, minBaseVersionRef } = state;
  const { port } = deps;
  const { enqueue, preserveFailedSave, markStaleBasis, liftStaleGate, dropLocalBackup } = actions;
  /** The one place `putAutosave` is called. Its `{ applied }` answer is acted on here rather than
   *  discarded — see this file's STALE BASIS note. @complexity Time/space: O(1) plus the request. */
  const writeAutosave = useCallback(
    (id: string, draft: StandingDraftAutosaveInput, keepalive: boolean) => {
      const generation = backupGenerationRef.current;
      return enqueue(async () => {
        let result: { applied: boolean };
        try {
          result = await port.putAutosave({ id, draft }, { keepalive });
        } catch (error) {
          // A 401 can unmount the editor before this settles; the captured identity still owns it.
          // Use the newest scheduled text, since an older request may fail while typing continues.
          if (generation === backupGenerationRef.current) preserveFailedSave({ error, draft: latestDraftRef.current ?? draft });
          throw error;
        }
        if (generation !== backupGenerationRef.current) return;
        if (!result.applied) {
          // Refused because the caller already moved past this basis — nothing to pause or mirror.
          if (isSupersededBasis(draft.baseVersion, minBaseVersionRef.current)) return;
          markStaleBasis(id, draft);
          return;
        }
        // Accepted — the text is parked server-side now, which is the ONLY point at which the
        // mirror is redundant and may go.
        liftStaleGate();
        dropLocalBackup();
      });
    },
    [dropLocalBackup, enqueue, liftStaleGate, markStaleBasis, port, preserveFailedSave]
  );

  return writeAutosave;
}

export function useStandingDraftSchedule(state: ReturnType<typeof useStandingDraftState>, deps: StandingDraftAutosaveOptions, actions: { liftStaleGate: ReturnType<typeof useStandingDraftStaleBasis>["liftStaleGate"]; clearPendingTimer: ReturnType<typeof useStandingDraftTimer>; writeAutosave: ReturnType<typeof useStandingDraftWriter> }) {
  const { latestDraftRef, minBaseVersionRef, staleBasisRef, firstPendingAtRef, pendingDraftRef, idleTimerRef } = state;
  const { enabled, entryId } = deps;
  const { liftStaleGate, clearPendingTimer, writeAutosave } = actions;
  const scheduleAutosave = useCallback(
    (draft: StandingDraftAutosaveInput) => {
      if (!enabled || !entryId) return;
      latestDraftRef.current = draft;
      if (isSupersededBasis(draft.baseVersion, minBaseVersionRef.current)) return;
      // The gate. Same basis as the one the server already refused => this write would be refused
      // too, so it is not scheduled at all; a DIFFERENT basis means the editor reloaded the row, so
      // the gate lifts by itself and no caller has to remember to reset anything.
      const stale = staleBasisRef.current;
      if (stale !== null && stale.baseVersion === draft.baseVersion) return;
      // The mirror is deliberately left in place here: nothing has been written yet, so until the
      // server accepts, that mirror is still the only copy of the refused text that outlives the tab.
      liftStaleGate();
      const now = Date.now();
      if (firstPendingAtRef.current === null) firstPendingAtRef.current = now;
      const waitedSoFar = now - firstPendingAtRef.current;
      // Clamped, not a plain "already past the ceiling?" check: without the clamp, a call arriving
      // just before the ceiling would still schedule a FULL fresh `IDLE_DEBOUNCE_MS`, pushing the
      // actual fire time past `MAX_WAIT_MS` under continuous typing (verified by the ceiling test —
      // an unclamped version never fires within the window it claims to bound).
      const delay = Math.max(0, Math.min(IDLE_DEBOUNCE_MS, MAX_WAIT_MS - waitedSoFar));

      pendingDraftRef.current = draft;
      if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        idleTimerRef.current = null;
        firstPendingAtRef.current = null;
        pendingDraftRef.current = null;
        // Not an exit: the page is still here, so an ordinary fetch (no 64 KiB ceiling) is right.
        writeAutosave(entryId, draft, false);
      }, delay);
    },
    [enabled, entryId, liftStaleGate, writeAutosave]
  );

  /**
   * Writes a pending (not yet fired) autosave immediately instead of waiting the debounce out —
   * the half of the cadence that makes the owner's actual requirement true ("what if they reload
   * the page on accident or exit out of the page? I don't want them to lose their work"). The
   * debounce always leaves a window of up to {@link IDLE_DEBOUNCE_MS} in which the newest edit
   * exists only in React state; without this, every exit inside that window discards it.
   *
   * Goes onto the same serial chain every other write uses, so it can never overtake an in-flight
   * PUT or a discard already queued by {@link clearStandingDraft} — and because that function
   * nulls `pendingDraftRef`, a flush after a real Save is a no-op rather than a resurrection.
   *
   * @complexity Time/space: O(1) — one ref read and at most one enqueued request.
   */
  const flushPendingAutosave = useCallback(
    (keepalive: boolean) => {
      const draft = pendingDraftRef.current;
      if (draft === null || !entryId) return;
      clearPendingTimer();
      writeAutosave(entryId, draft, keepalive);
    },
    [clearPendingTimer, entryId, writeAutosave]
  );

  return { scheduleAutosave, flushPendingAutosave };
}

export function useStandingDraftExitFlush(deps: StandingDraftAutosaveOptions, flushPendingAutosave: ReturnType<typeof useStandingDraftSchedule>["flushPendingAutosave"]) {
  const { enabled, entryId } = deps;
  // Flush, do not cancel, when this editor goes away. An in-app navigation (the "Posts"/"Pages"
  // back link, or any router move) unmounts the hook while a debounced tick is still pending, and
  // the previous cancel-on-unmount is exactly how the last seconds of typing were lost — verified
  // in a real browser on 2026-09-06: typed into the Pages editor, followed the in-app link one
  // second later, and no PUT was ever issued. The SPA outlives the unmount, so the request started
  // here completes normally. Re-running on an `entryId` change is correct too: the cleanup closes
  // over the OUTGOING entry, so switching entries parks the one being left behind.
  // `keepalive: false` — an unmount is an in-app navigation, not a page teardown. The SPA outlives
  // it, so the request started here completes normally and must not pay keepalive's body ceiling.
  useEffect(() => () => flushPendingAutosave(false), [flushPendingAutosave]);

  // The exits React never sees. `pagehide` covers a tab close, a reload and a same-tab navigation;
  // `visibilitychange` covers a tab switch or the OS backgrounding the browser, where `pagehide`
  // may never fire; `blur` covers switching to another desktop app with the tab still visible.
  // `beforeunload` is deliberately NOT one of them — `use-dirty-guard.hooks.ts` already registers
  // it, and it is a PROMPT, not a persistence hook: answering "Leave" still discards whatever the
  // debounce had not written. Each handler is a no-op when nothing is pending, so overlapping
  // events (a close fires blur AND pagehide) cost one write, not three.
  useEffect(() => {
    if (!enabled || !entryId) return undefined;
    // Wrapped rather than passed straight to `addEventListener`: a listener is called WITH the
    // Event, which would arrive as `flushPendingAutosave`'s `keepalive` argument — a truthy object,
    // so every flush would silently request keepalive whether or not it is an exit.
    const onExit = () => flushPendingAutosave(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushPendingAutosave(true);
    };
    window.addEventListener("pagehide", onExit);
    window.addEventListener("blur", onExit);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onExit);
      window.removeEventListener("blur", onExit);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, entryId, flushPendingAutosave]);

}

export function useStandingDraftDiscard(state: ReturnType<typeof useStandingDraftState>, deps: StandingDraftAutosaveOptions, actions: ReturnType<typeof useStandingDraftStaleBasis> & { enqueue: ReturnType<typeof useStandingDraftQueue>; clearPendingTimer: ReturnType<typeof useStandingDraftTimer> }) {
  const { backupGenerationRef, setRecoverableDraft, minBaseVersionRef, pendingDraftRef, staleBasisRef } = state;
  const { entryId, port } = deps;
  const { clearPendingTimer, liftStaleGate, dropLocalBackup, enqueue } = actions;
  const clearStandingDraft = useCallback(async (_required: Record<string, never> = {}, { keepOnFailure = false }: { keepOnFailure?: boolean } = {}) => {
    // A late 401/refusal must not resurrect a draft a successful Save or Discard superseded.
    backupGenerationRef.current++; clearPendingTimer();
    // keepOnFailure holds the banner and the local copy until the server confirms the discard.
    // A real Save landed (or the operator discarded): whatever was refused is superseded, so the
    // gate lifts and the mirror goes with it — otherwise the next mount would offer a ghost. This
    // is also the ONLY thing that clears a mirror the operator has already been shown and chose to
    // discard, since by then the gate that wrote it belongs to a previous mount.
    const settleLocally = () => { setRecoverableDraft(null); liftStaleGate(); dropLocalBackup(); };
    if (!keepOnFailure || !entryId) settleLocally();
    if (!entryId) return { discarded: true };
    const outcome = await discardOnServer({ enqueue, port, entryId });
    if (keepOnFailure && outcome.discarded) settleLocally();
    return outcome;
  }, [clearPendingTimer, dropLocalBackup, enqueue, entryId, liftStaleGate, port]);

  const dismissRecoverable = useCallback(() => setRecoverableDraft(null), []);

  const supersedeBasis = useCallback(
    (baseVersion: number) => {
      minBaseVersionRef.current = baseVersion;
      const pending = pendingDraftRef.current;
      if (pending !== null && isSupersededBasis(pending.baseVersion, baseVersion)) clearPendingTimer();
      const stale = staleBasisRef.current;
      if (stale !== null && isSupersededBasis(stale.baseVersion, baseVersion)) liftStaleGate();
    },
    [clearPendingTimer, liftStaleGate]
  );

  return { clearStandingDraft, dismissRecoverable, supersedeBasis };
}

/** Queues the server discard behind any pending write and says whether the server dropped the draft.
 *  A throw is logged by `enqueue` and leaves `discarded` false; `{ ok: false }` is the server keeping it.
 *  @complexity O(1) plus one queued request. */
async function discardOnServer(
  { enqueue, port, entryId }: { enqueue: (op: () => Promise<void>) => Promise<void>; port: StandingDraftAutosavePort; entryId: string },
  _optional = {},
): Promise<{ discarded: boolean }> {
  let discarded = false;
  await enqueue(async () => { discarded = (await port.discardAutosave({ id: entryId }, {})).ok; });
  return { discarded };
}

/** Whether a write built on `baseVersion` belongs to a basis the caller has left (see
 *  `supersedeBasis`). @complexity O(1). */
function isSupersededBasis(baseVersion: number, minBaseVersion: number | null): boolean {
  return minBaseVersion !== null && baseVersion < minBaseVersion;
}
