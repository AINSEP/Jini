export type SettingsRefreshScope = readonly string[] | null;

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
