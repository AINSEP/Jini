import { useCallback, useEffect } from "react";
import type { StandingDraftAutosaveOptions} from "./use-standing-draft-autosave.hooks.js";
import type { StandingDraftAutosaveInput, StandingDraftStaleBasis } from "@jini-ai/core/contracts/standing-draft";
import type { useStandingDraftState } from "./use-standing-draft-state.hooks.js";

export function useStandingDraftStaleBasis(state: ReturnType<typeof useStandingDraftState>, deps: StandingDraftAutosaveOptions) {
  const { staleBasisRef, setStaleBasis, backupPrincipalId, backupEntryIdRef } = state;
  const { backup } = deps;
  /** The server refused this draft. Records the basis, and mirrors the text locally — the ONLY
   *  place it can survive a tab close while the server keeps refusing it. @complexity O(1). */
  const markStaleBasis = useCallback((id: string, draft: StandingDraftAutosaveInput) => {
    const next: StandingDraftStaleBasis = { baseVersion: draft.baseVersion, draft };
    staleBasisRef.current = next;
    setStaleBasis(next);
    backup.write({ entryId: id, draft, savedAt: new Date().toISOString() }, { principalId: backupPrincipalId });
    backupEntryIdRef.current = id;
  }, [backupPrincipalId, backup]);

  /** Lifts the gate so scheduling resumes. Does NOT touch the mirror — see this file's header for
   *  why those two are separate. No-op when nothing is stale, so the common path never re-renders.
   *  @complexity O(1). */
  const liftStaleGate = useCallback(() => {
    if (staleBasisRef.current === null) return;
    staleBasisRef.current = null;
    setStaleBasis(null);
  }, []);

  /** Drops the browser-storage mirror for the entry being edited, if it has one. Called only where
   *  the operator's text provably survives somewhere else — the server just accepted a write (so it
   *  is parked server-side), or a real Save/discard superseded it. @complexity O(1). */
  const dropLocalBackup = useCallback(() => {
    const id = backupEntryIdRef.current;
    if (id === null) return;
    backupEntryIdRef.current = null;
    backup.clear({ entryId: id }, { principalId: backupPrincipalId });
  }, [backupPrincipalId, backup]);

  return { markStaleBasis, liftStaleGate, dropLocalBackup };
}

export function useStandingDraftRecovery(state: ReturnType<typeof useStandingDraftState>, deps: StandingDraftAutosaveOptions) {
  const { setRecoverableDraft, staleBasisRef, setStaleBasis, backupEntryIdRef, minBaseVersionRef, latestDraftRef, backupPrincipalId } = state;
  const { enabled, entryId, port, backup } = deps;
  // Mount-time (and entry-change) recovery check — one read, never repeated while this entryId
  // stays mounted. A stale in-flight response from a PREVIOUS entryId is dropped via `cancelled`.
  useEffect(() => {
    setRecoverableDraft(null);
    // A different entry is a different basis. A gate recorded for the PREVIOUS entryId must never
    // silence autosave for this one — their `version` numbers are very often both 1, so leaving it
    // set would silently stop autosaving an entry nobody has a conflict on. In-memory only: the
    // previous entry's local mirror is keyed under ITS id and stays recoverable there.
    staleBasisRef.current = null;
    setStaleBasis(null);
    // Same reasoning for the mirror pointer, one step further: the previous entry's mirror stays in
    // storage under ITS OWN key and stays recoverable there — only this hook's permission to drop a
    // mirror is reset, so a later accepted write for THIS entry cannot delete that other copy.
    backupEntryIdRef.current = null;
    minBaseVersionRef.current = null;
    latestDraftRef.current = null;
    if (!enabled || !entryId) return undefined;
    let cancelled = false;
    port
      .getAutosave({ id: entryId }, {})
      .then((result) => {
        if (cancelled) return;
        const localBackup = backup.read({ entryId }, { principalId: backupPrincipalId });
        // Recorded whether or not it is the copy shown below: it exists, so a real Save or an
        // explicit discard on this entry has to be able to drop it. Without this the mirror written
        // before a reload would outlive every discard and re-offer itself on every later mount.
        if (localBackup !== null) backupEntryIdRef.current = entryId;
        // Historically server first — a parked draft is shared across tabs. For expiry recovery,
        // compare capture times instead: a 401 mirror may contain edits newer than that parked copy. The local
        // mirror is the fallback for exactly the case that produced it: the other tab's real save
        // cleared the server-side draft, so this tab reloads into "nothing to recover" while its
        // own refused text is the thing the operator actually wants back.
        const server = result.autosave;
        // A 401 mirror can be newer than the last accepted server autosave. Keep the newest copy.
        const newest = localBackup && (!server || localBackup.savedAt > server.savedAt) ? localBackup : server;
        setRecoverableDraft(newest);
      })
      .catch(() => {
        // A failed server recovery read must not hide the local copy rescued from an expired session.
        if (cancelled) return;
        const localBackup = backup.read({ entryId }, { principalId: backupPrincipalId });
        if (localBackup !== null) backupEntryIdRef.current = entryId;
        setRecoverableDraft(localBackup);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, entryId, port, backupPrincipalId, backup]);

}

export function useStandingDraftFailedSave(state: ReturnType<typeof useStandingDraftState>, deps: StandingDraftAutosaveOptions) {
  const { backupPrincipalId, backupEntryIdRef } = state;
  const { entryId, backup } = deps;
  const preserveFailedSave = useCallback(({ error, draft }: { error: unknown; draft: StandingDraftAutosaveInput }, _options: Record<string, never> = {}) => {
    if (!entryId || !isUnauthorizedDraftWrite(error)) return;
    backup.write({ entryId, draft, savedAt: new Date().toISOString() }, { principalId: backupPrincipalId });
    backupEntryIdRef.current = entryId;
  }, [entryId, backupPrincipalId, backup]);

  return preserveFailedSave;
}

function isUnauthorizedDraftWrite(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 401;
}
