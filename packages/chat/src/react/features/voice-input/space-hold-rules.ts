/**
 * @file Pure decision logic for a hold-to-talk gesture on a composer key — no DOM, no timers, no
 * React — so every branch is directly assertable. The host's hook owns the listeners and the
 * timer, and supplies the bound key and the hold duration; this file owns "what should happen".
 *
 * **Why the gesture is gated on an EMPTY draft.** Holding a printable key inside a text field fires
 * OS key repeat, so a plain "hold the key anywhere" binding types a run of characters into whatever
 * the user was already writing, which then has to be swallowed and undone. Requiring the draft to
 * be empty removes that class of bug outright: there is no text to corrupt, and the one character
 * the initial keydown does type is discarded for free when the composer's insertion rule replaces a
 * whitespace-only draft rather than appending to it (`appendComposerDiscovery` in `@jini-ai/chat`).
 * Key repeat itself is still suppressed — see {@link resolveSpaceHoldKeyDown}'s `"suppress"`
 * action — so the caret never marches across the box during a hold.
 *
 * The mic button stays the always-available path once anything has been typed.
 */

/** Where the gesture currently is. `"armed"` means the timer is running but the mic is not open. */
export type SpaceHoldPhase = "released" | "armed" | "engaged";

/**
 * - `"ignore"` — leave the event entirely alone; the browser types its normal character.
 * - `"arm"` — start the hold timer. Deliberately does NOT suppress this first keystroke (see the
 *   file header): a quick tap must still produce a real, browser-typed character.
 * - `"suppress"` — `preventDefault()` and change nothing. This is the key-repeat case.
 */
export type SpaceHoldKeyDownAction = "ignore" | "arm" | "suppress";

export interface SpaceHoldKeyDownInput {
  /** The key the event reported. */
  key: string;
  /** The key the gesture is bound to, supplied by the host. */
  holdKey: string;
  /** True mid-IME-composition, where the key commits a candidate and is never a gesture. */
  isComposing: boolean;
  phase: SpaceHoldPhase;
  /** The composer's live text. Whitespace-only counts as empty — there is nothing to corrupt. */
  draft: string;
}

/**
 * Decides what a hold-key keydown should do.
 *
 * Whether voice input is available at all is NOT an input here: the caller binds no listener when
 * it is unavailable, so there is exactly one source of truth for that and no second copy here to
 * drift from it.
 *
 * @returns See {@link SpaceHoldKeyDownAction}.
 * @complexity Time/space: O(n) in draft length (one `trim`), O(1) otherwise.
 */
export function resolveSpaceHoldKeyDown(input: SpaceHoldKeyDownInput, _optional = {}): SpaceHoldKeyDownAction {
  if (input.key !== input.holdKey || input.isComposing) return "ignore";
  // Already armed or recording: every further keydown is OS key repeat. Swallow the character so
  // the caret does not march across the box while the user holds.
  if (input.phase !== "released") return "suppress";
  return input.draft.trim() === "" ? "arm" : "ignore";
}

/**
 * - `"ignore"` — not the bound key, or no gesture was in flight.
 * - `"disarm"` — released before the threshold: a quick tap. The character the browser already
 *   typed on keydown stands; nothing is started and nothing is undone.
 * - `"release"` — released after the mic opened: stop recording and transcribe.
 */
export type SpaceHoldKeyUpAction = "ignore" | "disarm" | "release";

/**
 * Decides what a hold-key keyup should do.
 *
 * @complexity Time/space: O(1).
 */
export function resolveSpaceHoldKeyUp({ key, holdKey, phase }: { key: string; holdKey: string; phase: SpaceHoldPhase }, _optional = {}): SpaceHoldKeyUpAction {
  if (key !== holdKey) return "ignore";
  if (phase === "armed") return "disarm";
  return phase === "engaged" ? "release" : "ignore";
}
