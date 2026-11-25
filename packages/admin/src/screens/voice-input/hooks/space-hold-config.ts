/**
 * @file The two knobs the host hands to Jini's hold-to-talk decision rules: which composer key the
 * gesture is bound to and how long it must be held. The decision logic itself lives in
 * `@jini-ai/chat/react/features/voice-input/space-hold-rules`.
 */

/**
 * How long space must be held before the microphone opens.
 *
 * Tuned to the low end of ordinary push-to-talk engagement (a few hundred ms): long enough that a
 * normal space keystroke can never trip it, short enough that the operator is not waiting on the
 * gesture before every utterance. Named, and referenced from exactly one place, so it can be
 * retuned here alone.
 */
export const SPACE_HOLD_TO_TALK_MS = 450;

/** The composer key the gesture is bound to. */
export const SPACE_KEY = " ";
