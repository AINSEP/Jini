import type { SettingsSliceOptions, SettingsSlice } from "./settings-slice.helpers.js";
import { useSettingsSliceState as useSettingsSliceStateDefault, useSettingsSliceLoad as useSettingsSliceLoadDefault } from "./use-settings-slice-state.hooks.js";
import { useSettingsSliceSave as useSettingsSliceSaveDefault, useSettingsSliceChange as useSettingsSliceChangeDefault } from "./use-settings-slice-save.hooks.js";
import { useSettingsSliceRefresh as useSettingsSliceRefreshDefault, useSettingsSliceSubscription as useSettingsSliceSubscriptionDefault } from "./use-settings-slice-refresh.hooks.js";

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
export function useSettingsSlice<T>(options: SettingsSliceOptions<T>, { useSettingsSliceState = useSettingsSliceStateDefault, useSettingsSliceLoad = useSettingsSliceLoadDefault, useSettingsSliceSave = useSettingsSliceSaveDefault, useSettingsSliceChange = useSettingsSliceChangeDefault, useSettingsSliceRefresh = useSettingsSliceRefreshDefault, useSettingsSliceSubscription = useSettingsSliceSubscriptionDefault }: { useSettingsSliceState?: typeof useSettingsSliceStateDefault, useSettingsSliceLoad?: typeof useSettingsSliceLoadDefault, useSettingsSliceSave?: typeof useSettingsSliceSaveDefault, useSettingsSliceChange?: typeof useSettingsSliceChangeDefault, useSettingsSliceRefresh?: typeof useSettingsSliceRefreshDefault, useSettingsSliceSubscription?: typeof useSettingsSliceSubscriptionDefault } = {}): SettingsSlice<T> {
  const state = useSettingsSliceState(options);
  const { value, loadError, saveState } = state;
  useSettingsSliceLoad(state);
  const runSave = useSettingsSliceSave(state);
  const onChange = useSettingsSliceChange(state, runSave);
  const refresh = useSettingsSliceRefresh(state);
  useSettingsSliceSubscription(state, refresh, options);
  return { value, loadError, saveState, onChange, refresh };
}
