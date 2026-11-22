/**
 * @module providers/turn-end-guard
 *
 * Extracted, directly-testable fix for OD's confirmed duplicate-`end`-event
 * bug (see `anthropic-messages.ts`'s module doc and `ADS-memory/reports/
 * proposals/PROP-http-route-packs-chat-model-proxy-2026-07-21.md`): a
 * tool-loop turn-runner has multiple call sites that each *want* to end the
 * turn's event stream (role-marker-guard contamination, normal completion,
 * the tool-turn ceiling, a request/stream error) — this guarantees at most
 * one of them actually reaches `onEvent`.
 *
 * Pulled out of `anthropic-messages.ts`/`openai-chat.ts` into its own
 * module (rather than duplicating an identical `let ended = false` closure
 * in both files) per this repo's "no scope cuts for coverage — extract
 * instead" rule: both turn-runners are structured so every call site that
 * can reach `emitEnd` is already immediately followed by a `break`/`return`
 * (traced and documented at each call site), which makes the guard's own
 * "already ended, no-op" branch unreachable through either turn-runner's
 * *own* integration-level tests — not because the guard is unnecessary
 * (the task requires it, and a future code change that adds a call site
 * without an immediate `break` would silently regress without it), but
 * because a correctly-written caller never exercises the redundant path.
 * Extracting the guard into its own pure, minimal unit gives it real,
 * direct coverage instead of leaving that branch dark or faking an
 * artificial caller-side scenario just to trip it.
 */

/** Why a turn-runner's event stream ended. Shared verbatim by `anthropic-messages.ts#AnthropicTurnEndReason` and `openai-chat.ts#OpenAiTurnEndReason`. */
export type TurnEndReason = 'stop' | 'contaminated' | 'max_tool_turns' | 'error';

export interface TurnEndGuard {
  /** Emits the end event via `onEvent` on the first call; every subsequent call (any reason) is a silent no-op. */
  readonly emitEnd: (reason: TurnEndReason) => void;
  /** True once `emitEnd` has fired. */
  readonly hasEnded: () => boolean;
}

/** Builds a fresh, single-use end guard. `makeEndEvent` lets each turn-runner's own event union shape (`AnthropicTurnEvent`/`OpenAiTurnEvent`) stay independent — this module has no opinion on it. */
export function createTurnEndGuard<Event>(
  { onEvent,
  makeEndEvent }: { onEvent: (event: Event) => void; makeEndEvent: (reason: TurnEndReason) => Event }, _optional: Record<string, never> = {},
): TurnEndGuard {
  let ended = false;
  return {
    emitEnd(reason: TurnEndReason): void {
      if (ended) return;
      ended = true;
      onEvent(makeEndEvent(reason));
    },
    hasEnded(): boolean {
      return ended;
    },
  };
}
