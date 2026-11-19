import { useCallback, useEffect } from "react";
import type { useSettingsSliceState } from "./use-settings-slice-state.hooks.js";
import { commitQueuedSave, SAVE_DEBOUNCE_MS } from "./settings-slice.helpers.js";

export function useSettingsSliceSave<T>(state: ReturnType<typeof useSettingsSliceState<T>>) {
  const { latest, io, persisted, commits, hasUnsavedEdits, timer, writes } = state;
  /**
   * The only place a save is ever issued.
   *
   * Both the target and the diff base are read at RUN time, never at schedule
   * time. By the time a chained link runs, an earlier save may already have
   * advanced `persisted` and the operator may have edited further, so anything
   * captured when the link was queued is potentially a lie about the store.
   *
   * This exists as one function rather than two call sites because the second
   * call site is exactly where that invariant was lost: the unmount flush used
   * to snapshot both values as it queued itself behind an in-flight save, so
   * edit A→B, revert B→A, unmount produced `save(A, A)` — an empty diff — and
   * the revert was dropped while the store kept B. Sharing the runner makes the
   * rule structural instead of something each caller has to remember.
   */
  const runSave = useCallback(async (): Promise<readonly string[]> => {
    const target = latest.current;
    const written = await io.current.save({ next: target, previous: persisted.current }, {});
    // `persisted` is deliberately advanced only here, after a resolved save, so
    // a rejection leaves the base alone and the next save re-attempts the
    // fields this one could not write.
    persisted.current = target;
    commits.current += 1;
    // Only clear the flag if nothing was edited WHILE this save ran.
    if (latest.current === target) hasUnsavedEdits.current = false;
    // Notify same-tab siblings this slice has no direct connection to — same rationale
    // `settings-refresh-bus.ts`'s own doc comment gives for `AssistantDock`: this slice and
    // whatever else reads this namespace (e.g. `useAdminLocale()`, read by ~30 screens outside the
    // Settings dialog for `core.language`) are unrelated subtrees under `App.tsx` with no shared
    // state. Without this, a language switch only reached OTHER tabs via SSE — the tab that made
    // the change never re-read its own write, so it looked "stuck" until a hard reload. Scoped to
    // this slice's own declared `namespaces`, so an unrelated slice's save doesn't trigger a
    // pointless refetch elsewhere; a slice that never declared `namespaces` publishes nothing,
    // matching that it never subscribed to anything either.
    if (io.current.namespaces && io.current.namespaces.length > 0) {
      io.current.refreshPort.publish({ namespaces: io.current.namespaces }, {});
    }
    return written;
  }, []);

  // On unmount, don't just drop a debounced edit — run it. Cancelling the
  // timer silently discards whatever the operator typed in the last 600ms.
  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      if (!hasUnsavedEdits.current) return;
      // Fire-and-forget: the component is going away, so there is no status
      // left to paint. The write itself still has to happen — through the same
      // lane as the debounce path, so it diffs against the base that is
      // current when it RUNS, not the one that was current when it was queued.
      // No view remains to show the failure; settings and native errors may contain secrets.
      const reportFinalFailure = () => { console.error('[settings] Final save failed after unmount.'); };
      const finalSave = async () => { try { await runSave(); } catch { reportFinalFailure(); } };
      void writes.run({ task: finalSave });
    },
    [runSave, writes],
  );

  return runSave;
}

export function useSettingsSliceChange<T>(state: ReturnType<typeof useSettingsSliceState<T>>, runSave: () => Promise<readonly string[]>) {
  const { setValue, latest, hasUnsavedEdits, timer, saveTicket, setSaveState, writes } = state;
  const onChange = useCallback((next: T) => {
    setValue(next);
    latest.current = next;
    hasUnsavedEdits.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // Cleared as the timer FIRES, so `timer.current` means "a debounce is still pending" rather
      // than "one was ever scheduled". The unmount flush below already pairs it with
      // `hasUnsavedEdits`, so it tolerated a stale handle; `refresh` reads it alone as the
      // "operator has work in flight" signal, and a handle that never cleared would refuse every
      // external refresh for the rest of the component's life after the first keystroke.
      timer.current = null;
      saveTicket.current += 1;
      const ticket = saveTicket.current;
      setSaveState({ status: "saving" });
      const deps = { runSave, currentTicket: () => saveTicket.current,
        hasUnsavedEdits: () => hasUnsavedEdits.current, setSaveState };
      void writes.run({ task: () => commitQueuedSave({ ticket, deps }, {}) });
    }, SAVE_DEBOUNCE_MS);
  }, [runSave, writes]);

  return onChange;
}
