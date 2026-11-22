import { useCallback, useEffect } from "react";
import type { useSettingsSliceState } from "./use-settings-slice-state.hooks.js";
import type { SettingsSliceOptions } from "./settings-slice.helpers.js";
import { canAcceptRefresh } from "./settings-slice.helpers.js";

export function useSettingsSliceRefresh<T>(state: ReturnType<typeof useSettingsSliceState<T>>) {
  const { timer, hasUnsavedEdits, commits, refreshSettlement, io, mounted, latest, persisted, setValue } = state;
  /**
   * Re-reads the persisted value on an external notification.
   *
   * **Refuses whenever the operator has uncommitted work**, rather than merging. Three states count
   * as uncommitted: a pending debounce timer, `hasUnsavedEdits`, and a non-idle save. Overwriting
   * any of them replaces what the operator typed with a value from somewhere else, mid-keystroke —
   * data loss, and the same class of bug the audit already found twice in this file. Refusing costs
   * only a missed update, and the operator's own save re-establishes agreement a moment later.
   *
   * The check runs AGAIN after the await: `load()` is a network round trip, and an edit begun while
   * it was in flight would otherwise be clobbered by a response that predates it.
   *
   * Re-checking the flags is necessary but NOT sufficient, which is why {@link commits} is sampled
   * too. Both flags describe work that is still outstanding, so a save that started and finished
   * entirely within the await window leaves them clear and the stale response sails through — see
   * the counter's own doc for why that is worse than a wrong repaint.
   *
   * A failed reload is swallowed on purpose. This is a background refresh the operator never asked
   * for; surfacing `loadError` here would replace a working panel with an error state because of a
   * transient blip. The mount load still reports its failures.
   */
  const refresh = useCallback(async () => {
    if (
      !canAcceptRefresh({
        timerPending: timer.current !== null,
        hasUnsavedEdits: hasUnsavedEdits.current,
        mounted: true,
        commitsUnchanged: true,
      })
    ) {
      return;
    }
    const seenCommits = commits.current;
    const generation = refreshSettlement.next();
    let loaded: T;
    try {
      loaded = await io.current.load({}, {});
    } catch {
      return;
    }
    if (
      !refreshSettlement.isCurrent({ generation }) ||
      !canAcceptRefresh({
        timerPending: timer.current !== null,
        hasUnsavedEdits: hasUnsavedEdits.current,
        mounted: mounted.current,
        commitsUnchanged: commits.current === seenCommits,
      })
    ) {
      return;
    }
    // `persisted` tracks what `load`/`save` actually manage, so it takes the RAW reload — a
    // reconciled field like a never-persisted API key has no business in the diff base `save` will
    // next diff against. `latest`/`value` are what the operator sees and edits next, so THEY take
    // the reconciled result.
    const reconciled = io.current.reconcileRefresh ? io.current.reconcileRefresh({ current: latest.current, loaded }, {}) : loaded;
    persisted.current = loaded;
    latest.current = reconciled;
    setValue(reconciled);
  }, []);

  return refresh;
}

export function useSettingsSliceSubscription<T>(state: ReturnType<typeof useSettingsSliceState<T>>, refresh: () => Promise<void>, options: SettingsSliceOptions<T>) {
  const { io } = state;
  /**
   * Subscribes to out-of-band changes — an assistant run that wrote a setting, or an SSE frame from
   * a write in another tab. `namespaces` narrows which notifications matter; see the option's doc
   * for why omitting it means "refresh on everything" rather than "never".
   */
  const refreshPort = options.refreshPort;
  useEffect(() => {
    return refreshPort.subscribe({ listener: (scope) => {
      const mine = io.current.namespaces;
      if (scope && mine && !mine.some((ns) => scope.includes(ns))) return;
      void refresh();
    } }, {});
  }, [refresh, refreshPort]);

}
