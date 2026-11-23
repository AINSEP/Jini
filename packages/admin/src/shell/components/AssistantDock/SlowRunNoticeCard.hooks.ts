/**
 * @file `SlowRunNoticeCard`'s two pure decision helpers, split out of the component (2026-09-05
 * Gemini audit finding 37) so the `.tsx` file stays props-and-JSX only, per this workspace's
 * standing "no functions or derived logic in a `.tsx` file" rule — the same split
 * `MessageOverflowModal`/`MessageOverflowModal.hooks.tsx` already uses one file over. Neither
 * helper below calls a React hook (no `useState`/`useEffect`/`useRef`) — both are plain, synchronous
 * derivations over already-available props — so this file exports functions directly rather than a
 * `useX` hook; `SlowRunNoticeCard.tsx` just calls them inline during render.
 *
 * Pure relocation only: neither helper's behavior changed by this move. See
 * `SlowRunNoticeCard.unit.test.tsx` for both helpers' coverage, carried over unchanged from when
 * they lived in the component file.
 */
import type { ExtEventRenderProps } from "../../../react/kit.js";

/**
 * Reads the most recent slow-run event's `detail` text, or `undefined` if the array is empty or the
 * entry is shaped unexpectedly (never trusted — this is untyped `unknown` data straight off the
 * wire, per `ExtEventRenderProps.events`'s own doc).
 *
 * Only the LATEST entry is read, not every occurrence: a run that stalls, recovers, and stalls again
 * should read as "still working" once, not as a growing list of identical lines — every occurrence
 * sharing this `name` already folds into one render slot at its first occurrence's position in the
 * transcript (`message-blocks.ts`'s own doc on `MessageBlock<Row>`'s `ext` variant).
 *
 * @param events - {@link ExtEventRenderProps.events} for the `"slow_running"` group.
 * @returns The server-supplied detail text, or `undefined` to signal "use the fallback copy".
 */
export function resolveSlowRunDetail(events: readonly unknown[]): string | undefined {
  const latest = events[events.length - 1] as { detail?: unknown } | undefined;
  return typeof latest?.detail === "string" && latest.detail.length > 0 ? latest.detail : undefined;
}

/**
 * Whether the "still working" notice is still an accurate thing to say.
 *
 * The daemon's watchdog fires once and is never retracted (see `SlowRunNoticeCard.tsx`'s own file
 * doc), so nothing upstream ever tells this card to stop rendering — it has to decide for itself.
 * `runSucceeded`'s own contract is "ignored while `runStreaming` is true" (it is only meaningful once
 * the run is already terminal), so a naive `!runStreaming` check alone would already cover both
 * terminal outcomes (success and failure alike) correctly. This checks `runSucceeded` too, rather
 * than relying on that contract being honored upstream: if a caller ever reports `runSucceeded: true`
 * before `runStreaming` catches up to `false`, this still hides immediately instead of parroting a
 * stale "still working" for one more render.
 *
 * @param input.runStreaming - {@link ExtEventRenderProps.runStreaming}.
 * @param input.runSucceeded - {@link ExtEventRenderProps.runSucceeded}.
 * @param options.awaitingAnswer - {@link ExtEventRenderProps.awaitingAnswer}. A run held on an open
 *   form or card is waiting on the person, not slow: the daemon's watchdog still fires (it sees no
 *   events while the form waits), and saying "taking longer than usual" under the form made a run
 *   waiting on the owner look hung (demo dry-run, 2026-10-05). Jini's own activity line says
 *   "Waiting for your answer above" meanwhile.
 * @returns `true` while the notice should still render; `false` once the run has reached any
 *   terminal outcome (succeeded, failed, or aborted), or while it awaits the person's answer.
 *
 * @complexity Time/space: O(1).
 */
export function isSlowRunNoticeVisible(
  { runStreaming, runSucceeded }: { runStreaming: boolean; runSucceeded: boolean },
  { awaitingAnswer = false }: { awaitingAnswer?: boolean } = {},
): boolean {
  return runStreaming && !runSucceeded && !awaitingAnswer;
}
