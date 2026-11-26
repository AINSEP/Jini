import { useCallback, useEffect, useRef, useState } from "react";
import type { RoutineRow } from "@jini-ai/core/contracts/site/routines";
import { RoutinesApiError, type RoutineAvailabilityState, type RoutineDraft, type RoutineRefusalReason, type RoutinesApi } from "./routines-api.js";

/**
 * @file Controller for the Routines screen. Why: loading, polling and writes share one rule set that
 * the component must not own: poll only while visible, discard a result that arrives after hide or a
 * newer load, never resubmit a stale write, and never let a refusal read as an empty ready list.
 */
export const ROUTINES_POLL_MS = 30_000;

export type RoutinesView =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "ready"; routines: readonly RoutineRow[] }>
  | Readonly<{ kind: "unavailable"; availability: Exclude<RoutineAvailabilityState, "ready">; reason: RoutineRefusalReason | null; errorId: string | null }>
  | Readonly<{ kind: "failed"; errorId: string | null }>;

export type RoutinesNotice = Readonly<{ key: "save-failed" | "stale" | "stale-delete"; errorId: string | null }>;
export type RoutinesTimers = Readonly<{ setInterval: (callback: () => void, ms: number) => unknown; clearInterval: (handle: unknown) => void }>;
export type RoutinesFocus = Readonly<{ subscribe: (callback: () => void) => () => void }>;

export type RoutinesController = Readonly<{
  view: RoutinesView; notice: RoutinesNotice | null; busyId: string | null;
  refresh: () => Promise<void>;
  save: (required: { draft: RoutineDraft; row: RoutineRow | null }) => Promise<boolean>;
  setEnabled: (required: { row: RoutineRow; enabled: boolean }) => Promise<boolean>;
  remove: (required: { row: RoutineRow }) => Promise<boolean>;
  dismissNotice: () => void;
}>;

/** What went wrong with a write, in the vocabulary the screen translates. */
function noticeFor({ error, deleting }: { error: unknown; deleting: boolean }): RoutinesNotice {
  if (error instanceof RoutinesApiError && error.stale) return { key: deleting ? "stale-delete" : "stale", errorId: error.errorId };
  return { key: "save-failed", errorId: error instanceof RoutinesApiError ? error.errorId : null };
}

export function useRoutinesController({ api, visible, focus, timers }: { api: RoutinesApi; visible: boolean; focus: RoutinesFocus; timers: RoutinesTimers }, _optional: Record<string, never> = {}): RoutinesController {
  const [view, setView] = useState<RoutinesView>({ kind: "loading" });
  const [notice, setNotice] = useState<RoutinesNotice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const mine = ++generation.current;
    try {
      const result = await api.list();
      if (mine !== generation.current) return;
      setView(result.state === "ready" ? { kind: "ready", routines: result.routines }
        : { kind: "unavailable", availability: result.state, reason: result.reason, errorId: result.errorId });
    } catch (error) {
      if (mine !== generation.current) return;
      const errorId = error instanceof RoutinesApiError ? error.errorId : null;
      // A transient failure must not wipe rows the operator is looking at.
      setView((previous) => (previous.kind === "ready" ? previous : { kind: "failed", errorId }));
    }
  }, [api]);

  useEffect(() => {
    if (!visible) { generation.current += 1; return undefined; }
    void refresh();
    const handle = timers.setInterval(() => void refresh(), ROUTINES_POLL_MS);
    const unsubscribe = focus.subscribe(() => void refresh());
    return () => { generation.current += 1; timers.clearInterval(handle); unsubscribe(); };
  }, [visible, refresh, timers, focus]);

  // On a stale write the list is reloaded and the write is NOT sent again: the owner must look first.
  const write = useCallback(async ({ id, deleting, op }: { id: string; deleting: boolean; op: () => Promise<unknown> }): Promise<boolean> => {
    setBusyId(id);
    try { await op(); setNotice(null); await refresh(); return true; }
    catch (error) { setNotice(noticeFor({ error, deleting })); if (error instanceof RoutinesApiError && error.stale) await refresh(); return false; }
    finally { setBusyId(null); }
  }, [refresh]);

  const save = useCallback(({ draft, row }: { draft: RoutineDraft; row: RoutineRow | null }) => (row === null
    ? write({ id: "new", deleting: false, op: () => api.create({ draft }) })
    : write({ id: row.id, deleting: false, op: () => api.update({ id: row.id, patch: draft, expectedRevision: row.revision }) })), [api, write]);
  const setEnabled = useCallback(({ row, enabled }: { row: RoutineRow; enabled: boolean }) =>
    write({ id: row.id, deleting: false, op: () => api.update({ id: row.id, patch: { enabled }, expectedRevision: row.revision }) }), [api, write]);
  const remove = useCallback(({ row }: { row: RoutineRow }) =>
    write({ id: row.id, deleting: true, op: () => api.remove({ id: row.id, revision: row.revision }) }), [api, write]);
  const dismissNotice = useCallback(() => setNotice(null), []);

  return { view, notice, busyId, refresh, save, setEnabled, remove, dismissNotice };
}
