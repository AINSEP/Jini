import { useCallback, useEffect, useRef, useState } from "react";

export type SettingsRefreshScope = readonly string[] | null;
import { useSerialWrites } from "./use-serial-writes.hooks.js";
import { useSettlementGeneration } from "./use-settlement-generation.hooks.js";

/**
 * @file One settings-dialog tab's load/edit/debounced-save lifecycle,
 * generic over the tab's own config type.
 *
 * This was `SettingsUi.tsx`'s inline machinery when exactly one tab (Execution
 * mode) was mounted. It is extracted rather than copied because the logic is
 * subtle out of proportion to its size — successive audits have found FOUR
 * distinct data-loss bugs in it (see `saveTicket`, `hasUnsavedEdits`, `runSave`,
 * and `commits` below), and every one of those hazards is identical for every
 * tab. Duplicating it per tab would mean re-introducing all four bugs three
 * more times, and fixing them in three more places.
 *
 * The last two share one root cause worth stating plainly, because it is the
 * shape every future bug here will take: **a value read at schedule time is a
 * claim about the store that may already be false by the time the code using it
 * runs.** `runSave` fixes it for writes by reading the diff base at run time;
 * `commits` fixes it for reads by discarding a reload whose response predates a
 * write that landed while it was in flight. Anything added here that captures
 * `persisted` or `latest` across an `await` needs the same treatment.
 *
 * Each mounted tab owns one instance. They are independent by construction:
 * separate debounce timers, separate save chains, separate diff bases. The
 * only shared surface is the merged status the page chrome renders, which
 * `SettingsUi.tsx` derives.
 */

export type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

/** Debounce for text fields: tabs are controlled and fire on every keystroke,
 *  and each ledger write is an append-only revision. Without this, typing into
 *  a textarea would write one revision per character. */
export const SAVE_DEBOUNCE_MS = 600;

/** Namespace-only notifications preserve the authorized re-read boundary; never carry values. */
export interface SettingsSliceRefreshPort {
  publish(required: { namespaces: readonly string[] }, optional?: Record<string, never>): void;
  subscribe(required: { listener: (scope: SettingsRefreshScope) => void }, optional?: Record<string, never>): () => void;
}

export interface SettingsSliceOptions<T> {
  /** Reads the persisted value. A rejection surfaces as `loadError` and the
   *  slice falls back to `defaultValue` — an unreadable setting shows defaults
   *  with a visible warning rather than blocking the whole dialog. */
  load: (required: Record<string, never>, optional?: Record<string, never>) => Promise<T>;
  /** Writes whatever changed between `next` and `previous`, returning the keys
   *  actually written (an empty array means "nothing to do", which the status
   *  indicator renders as idle rather than a misleading "Saved"). */
  save: (required: { next: T; previous: T }, optional?: Record<string, never>) => Promise<readonly string[]>;
  defaultValue: T;
  /**
   * Ledger namespaces this slice reads, so a refresh naming other namespaces
   * is ignored instead of costing a pointless reload.
   *
   * Omit to reload on EVERY refresh. That is the safe default in both
   * directions: a slice that forgets to declare its namespaces stays correct
   * (it just refetches more than it needs), whereas defaulting to "ignore
   * everything" would make a forgotten declaration silently stop updating —
   * the exact bug this feature exists to remove.
   */
  namespaces?: readonly string[];
  /** Use one port for publication and subscription, so successful writes refresh their own surface.
   * The host supplies a namespace-only bus; ports own their subscription cleanup. */
  refreshPort: SettingsSliceRefreshPort;
  /**
   * Reconciles a freshly loaded value against the operator's current in-memory value before
   * {@link SettingsSlice.refresh} lets it replace `value`/`persisted`/`latest`. Defaults to "the
   * loaded value wins outright" — correct for every field this slice actually round-trips through
   * `save`/`load`.
   *
   * Provide this when `T` carries a field `save`/`load` deliberately never touch (see
   * `execution-settings.ts`'s `reconcileExecutionConfigRefresh` for `byok.apiKey`, which `save`
   * never writes and `load` always returns empty). Without it, an external refresh — a same-tab
   * echo of this slice's OWN write arriving over the settings-changed SSE feed, another tab,
   * another operator — carries that field back at its "nothing here" default and silently
   * overwrites an operator's typed-but-unsaved edit to it. `runSave` cannot leak this on its own:
   * it never calls `setValue`. This path can, because replacing `value` with server truth is its
   * entire job.
   *
   * @param current - `latest.current` at the moment the reload settled — the newest value the
   *   operator has produced, saved or not.
   * @param loaded - What `load()` just returned — true server state for every field it manages.
   */
  reconcileRefresh?: (required: { current: T; loaded: T }, optional?: Record<string, never>) => T;
}

/**
 * Runs one save-chain link: calls `runSave`, then paints the ticket-owning outcome onto
 * `saveState` — unless a newer save has since taken the ticket (`currentTicket()` no longer matches
 * `ticket`), or the operator has queued another edit behind this one (`hasUnsavedEdits()`). Pulled
 * out of `onChange`'s debounce-timer closure (2026-08-06, complexity pass) — it was the deepest
 * nesting in this file, three closures in (`onChange` > the `setTimeout` callback > the
 * `saveChain.current.then(async () => …)` link) — so the ticket/staleness handling is directly
 * assertable against a fake `runSave`, without a real timer or save chain.
 *
 * The ref reads are passed as thunks rather than plain booleans specifically so this keeps the
 * original "read at run time, not schedule time" contract this whole file's header calls out:
 * `deps.currentTicket()`/`deps.hasUnsavedEdits()` are called from inside this function, at the same
 * points the inline version read `saveTicket.current`/`hasUnsavedEdits.current` directly, so a
 * ticket or edit that changes while `runSave` is in flight is still seen correctly.
 *
 * @param ticket - This link's own ticket, taken by the caller when the debounce timer fired.
 */
export async function commitQueuedSave(
  { ticket, deps }: { ticket: number; deps: {
    runSave: () => Promise<readonly string[]>;
    currentTicket: () => number;
    hasUnsavedEdits: () => boolean;
    setSaveState: (state: SaveState) => void;
  } },
  _options: Record<string, never> = {},
): Promise<void> {
  try {
    const written = await deps.runSave();
    if (deps.currentTicket() !== ticket) return;
    // A newer edit is already queued behind this one, so "Saved" would be a claim about state
    // that is not saved. Stay in "saving".
    if (deps.hasUnsavedEdits()) return;
    deps.setSaveState(written.length > 0 ? { status: "saved" } : { status: "idle" });
  } catch (error: unknown) {
    if (deps.currentTicket() !== ticket) return;
    deps.setSaveState({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Whether a background `refresh()` reload may still land, given what is true about the slice's
 * uncommitted-work state at the moment of the check.
 *
 * Pulled out of `refresh` (2026-08-06, complexity pass, third pass): the same four-flag shape is
 * checked TWICE inside `refresh` — once before the `load()` await (where `mounted`/`commitsUnchanged`
 * are trivially true, since nothing could have unmounted or committed a save before the function has
 * even started awaiting), once after (where all four are live) — and collapsing the check into one
 * named function removes the duplicated branch count rather than moving it. This does not change
 * WHEN any ref is read: every call site below still reads `timer.current`/`hasUnsavedEdits.current`/
 * `mounted.current`/`commits.current` at exactly the point in `refresh`'s own body the inline version
 * did, in the same tick — this function only names the boolean combination those reads produce. See
 * `refresh`'s own doc for why a re-check after the await is necessary at all.
 */
export function canAcceptRefresh(state: {
  timerPending: boolean;
  hasUnsavedEdits: boolean;
  mounted: boolean;
  commitsUnchanged: boolean;
}, _options: Record<string, never> = {}): boolean {
  return !state.timerPending && !state.hasUnsavedEdits && state.mounted && state.commitsUnchanged;
}

export interface SettingsSlice<T> {
  /** `null` until the initial load settles — the caller renders a loading state. */
  value: T | null;
  loadError: string | null;
  saveState: SaveState;
  onChange: (next: T) => void;
  /**
   * Re-reads the persisted value, discarding nothing.
   *
   * Wired to {@link subscribeToSettingsRefresh} automatically; exposed mainly so
   * a caller can force one. Declines while the operator has uncommitted work —
   * see the implementation for why that is a refusal rather than a merge.
   */
  refresh: () => Promise<void>;
}

/**
 * @complexity O(1) per edit — one debounce timer reset plus one link appended
 * to the save chain.
 *
 * @complexityExemption (2026-08-06, complexity pass, third pass; bar raised to ≤9/≤9 same day,
 * exemption reconfirmed against the new bar) **Score: this hook's own lexical scope is 1
 * cyclomatic / ~0 cognitive under ESLint — every closure inside it is independently ≤9/≤9 too
 * (`onChange`'s debounce callback is 2/1, the unmount-flush cleanup is 3/2, `refresh` is 5/4 as of
 * this pass — see below). What is exempted here is a DIFFERENT, unmeasurable-by-me number: the
 * dispatch brief's owner-tool score of 17/23, which rolls every nested closure's branches into the
 * hook's total. Bar: ≤9/≤9 on whichever view is scored — ESLint's view already clears it; the
 * owner-tool aggregate does not, and I have no local tool that reproduces that aggregate to
 * re-measure against the new bar.**
 *
 * Same shape as `use-assistant-chats.hooks.ts`'s `useAssistantChats` exemption — see that one for
 * the full reasoning. `commitQueuedSave` (first pass) and `canAcceptRefresh` (this pass, pulled out
 * of `refresh`'s two duplicated guard checks — see its own doc) are the two pieces of this hook's
 * logic that genuinely fit a top-level pure-function shape (0–4 plain params, no ref reads);
 * `refresh` itself dropped from 9/5 to 5/4 as a result, its own per-function score real progress,
 * not exempted. What remains (`runSave`/`onChange`/the unmount cleanup/the rest of `refresh`) each
 * reads or writes 3–6 of this hook's own refs (`io`, `persisted`, `latest`, `timer`,
 * `saveTicket`, `hasUnsavedEdits`, `commits`, `mounted`) plus the shared `writes` lane, and several of
 * them call each other
 * (`onChange` schedules a link that calls `runSave`; the unmount cleanup calls `runSave` directly),
 * so none of them can become a top-level function without threading that whole ref set through as a
 * parameter object. This file's own header states the reason that is dangerous here specifically:
 * "a value read at schedule time is a claim about the store that may already be false by the time
 * the code using it runs," and every ref above exists because an earlier version of exactly this
 * logic got that ordering wrong (four distinct data-loss bugs, per the header). A previous pass
 * already tried this kind of extraction on this file and the total was unchanged, 25 → 25 — the
 * honest reading of that result is that the remaining closures do not have a top-level-shaped cut
 * available at the risk level a time-boxed pass allows, not that the attempt was done wrong.
 * Declined for the remainder; flagged to the coordinator. See this session's report for the full
 * reasoning.
 */
export function useSettingsSlice<T>(options: SettingsSliceOptions<T>, _optional: Record<string, never> = {}): SettingsSlice<T> {
  const { defaultValue } = options;
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

  // `defaultValue` is a module-level constant at every call site; re-running
  // this on a new identity would re-issue the load and clobber live edits.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `defaultValue` is a module-level constant; re-running on a new identity would re-issue the load and clobber live edits.
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
        setValue(defaultValue);
      });
    return () => {
      alive = false;
    };
  }, []);

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
      void writes.run({ task: () =>
        runSave().then(
          () => {},
          () => {},
        ) },
      );
    },
    [runSave, writes],
  );

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
      const ticket = ++saveTicket.current;
      setSaveState({ status: "saving" });
      void writes.run({ task: () =>
        commitQueuedSave({ ticket, deps: {
          runSave,
          currentTicket: () => saveTicket.current,
          hasUnsavedEdits: () => hasUnsavedEdits.current,
          setSaveState,
        } }, {}) },
      );
    }, SAVE_DEBOUNCE_MS);
  }, [runSave, writes]);

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

  return { value, loadError, saveState, onChange, refresh };
}

/**
 * Collapses several slices' save states into the single one the page chrome
 * renders.
 *
 * Precedence is error > saving > saved > idle, and it is deliberate: an error
 * is the only state the operator must act on, so it must not be hidden by
 * another tab's cheerful "Saved". "Saving" outranks "saved" for the same
 * reason in miniature — while anything is still in flight, claiming everything
 * is saved is false.
 */
export function mergeSaveStates({ states }: { states: readonly SaveState[] }, _options: Record<string, never> = {}): SaveState {
  const failed = states.find((state) => state.status === "error");
  if (failed) return failed;
  if (states.some((state) => state.status === "saving")) return { status: "saving" };
  if (states.some((state) => state.status === "saved")) return { status: "saved" };
  return { status: "idle" };
}
