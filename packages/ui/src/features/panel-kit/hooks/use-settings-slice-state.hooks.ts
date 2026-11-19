import { useEffect, useRef, useState } from "react";
import type { SettingsSliceOptions, SaveState } from "./settings-slice.helpers.js";
import { useSerialWrites as useSerialWritesDefault } from "./use-serial-writes.hooks.js";
import { useSettlementGeneration as useSettlementGenerationDefault } from "./use-settlement-generation.hooks.js";

export function useSettingsSliceState<T>(options: SettingsSliceOptions<T>, { useSerialWrites = useSerialWritesDefault, useSettlementGeneration = useSettlementGenerationDefault }: { useSerialWrites?: typeof useSerialWritesDefault; useSettlementGeneration?: typeof useSettlementGenerationDefault } = {}) {
  const { defaultValue } = options;
  const initialDefaultValue = useRef(defaultValue);
  const [value, setValue] = useState<T | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

  /** Guards `refresh`'s own `setValue`/`persisted`/`latest` write against a second background
   *  refresh started after it: `canAcceptRefresh`'s `commitsUnchanged` check cannot tell two
   *  refreshes apart when no save happens between them (both sample the same `commits.current`),
   *  so without this an older refresh call that happens to SETTLE last could still land over a
   *  newer one's result (S2, plan-components.md 2026-09-20; two rapid SSE frames from another
   *  tab's writes is the trigger). Same guard `use-admin-execution-credential.hooks.ts`'s `refresh`
   *  and `use-admin-locale.hooks.ts`'s `fetchLocale` already use for the identical shape. */
  const refreshSettlement = useSettlementGeneration();

  /** `load`/`save` are usually inline arrows at the call site, so a new
   *  identity arrives on every render. Holding them in a ref keeps the effect
   *  and callback below from re-running (and re-loading, and dropping pending
   *  timers) once per render. */
  const io = useRef(options);
  io.current = options;

  /** Last value known to be persisted — the diff base handed to `save`. */
  const persisted = useRef<T>(defaultValue);

  /** The newest value the operator has produced, saved or not. A queued save
   *  writes THIS rather than whatever was current when it was scheduled, so a
   *  save that waited behind another still persists the latest state instead
   *  of resurrecting an intermediate one. */
  const latest = useRef<T>(defaultValue);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Saves run strictly one at a time, queued through this lane.
   *
   * The debounce alone does NOT prevent overlap: it only cancels a save that
   * has not STARTED. Once one is in flight, the next edit schedules a fresh
   * timer that can fire while the first is still running, and then two saves
   * race — their per-key writes interleave (so the ledger can end on the older
   * value), and both diff against the same `persisted` base, which the slower
   * one then overwrites on completion. That leaves the diff base claiming a
   * value was persisted that never was, so the next edit skips writing the
   * fields it thinks are already saved.
   */
  const writes = useSerialWrites();

  /** Monotonic ticket, so only the newest save may write the status
   *  indicator. Without it a slow earlier save resolving last would paint
   *  "Saved" over a newer save's error, or vice versa. */
  const saveTicket = useRef(0);

  /**
   * True whenever `latest` has moved ahead of `persisted` — i.e. the operator
   * has edited something no save has committed yet.
   *
   * The ticket alone does NOT cover this. A ticket is only taken when a
   * DEBOUNCE TIMER FIRES, so an edit made while an earlier save is still in
   * flight has no ticket yet: the in-flight save still owns the newest one,
   * completes, and paints "Saved" over changes that are not saved at all. If
   * the operator then navigates away, unmount clears the pending timer and
   * those edits are gone — with the UI's last word having been "Saved".
   */
  const hasUnsavedEdits = useRef(false);

  /**
   * Bumped every time a save commits and advances `persisted`.
   *
   * `refresh` samples it before its `load()` round trip and discards the
   * response if it moved. The two flag checks cannot cover this on their own:
   * `timer` and `hasUnsavedEdits` describe work that is still OUTSTANDING, and
   * a save that both started and finished inside the reload's await window
   * clears them, so a response that predates that write passes every check.
   * Letting it through does not merely repaint a stale value — it installs it
   * as the diff base, so the next edit diffs against a value the store never
   * held and skips writing the fields that differ.
   */
  const commits = useRef(0);

  /** Guards every post-await `setState` in {@link refresh}, which — unlike the
   *  mount load — can be invoked at any time by an external publisher. */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return { initialDefaultValue, value, setValue, loadError, setLoadError, saveState, setSaveState, refreshSettlement, io, persisted, latest, timer, writes, saveTicket, hasUnsavedEdits, commits, mounted };
}

export function useSettingsSliceLoad<T>(state: ReturnType<typeof useSettingsSliceState<T>>) {
  const { io, persisted, hasUnsavedEdits, latest, setValue, setLoadError, initialDefaultValue } = state;
  // `defaultValue` is a module-level constant at every call site; re-running
  // this on a new identity would re-issue the load and clobber live edits.
  useEffect(() => {
    let alive = true;
    io.current
      .load({}, {})
      .then((loaded) => {
        if (!alive) return;
        // `persisted` always takes the raw load, same as `refresh()` — it is the diff base the next
        // save diffs against, and the server's real state is a strictly better base than the
        // never-actually-persisted `defaultValue` this ref started at, whether or not the operator
        // has since edited.
        persisted.current = loaded;
        // Guards the same hazard `refresh()` guards via `canAcceptRefresh`'s `hasUnsavedEdits` check,
        // on the OTHER load path: `onChange` has no documented precondition requiring `value` to be
        // non-null first, so nothing stops an edit from landing before this initial `load()` settles.
        // Without this check, that edit is silently overwritten the instant the response arrives —
        // the same class of data loss this file's four prior audited bugs all belong to.
        if (hasUnsavedEdits.current) return;
        latest.current = loaded;
        setValue(loaded);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setLoadError(error instanceof Error ? error.message : String(error));
        if (hasUnsavedEdits.current) return;
        setValue(initialDefaultValue.current);
      });
    return () => {
      alive = false;
    };
  }, []);

}
