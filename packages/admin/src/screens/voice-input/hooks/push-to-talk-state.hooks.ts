/**
 * @file The push-to-talk state machine — pure, no DOM/Electron/audio APIs — so every transition
 * and every indicator label is directly testable without mocking a microphone.
 *
 * Trigger decision (owner-facing, see this feature's handoff notes for the full reasoning): this
 * is a HOLD gesture on the mic button itself (`pointerdown` starts, `pointerup`/`pointerleave`
 * stops) — never a keybinding on the composer's own textarea. Space is an ordinary character in a
 * text box; scoping the gesture to a button element outside the textarea means normal typing is
 * never at risk of being hijacked, regardless of composer focus or content.
 */

/** `"cancelling"`: the hold ended (key released, or the button lost the pointer) while still
 *  waiting on the permission prompt (`"requesting-mic"`). There is no capture to stop yet at that
 *  point — `usePushToTalk`'s own `startHold().then()` is what actually releases the microphone,
 *  once permission resolves, by checking whether the machine landed here instead of `"recording"`. */
export type PushToTalkStatus = "idle" | "requesting-mic" | "recording" | "transcribing" | "error" | "cancelling";

export interface PushToTalkState {
  status: PushToTalkStatus;
  /** Present only when `status === "error"` — the reason to show the user. */
  errorReason?: string;
}

export type PushToTalkEvent =
  | { type: "start" }
  | { type: "mic-granted" }
  | { type: "mic-denied"; reason: string }
  | { type: "stop" }
  | { type: "transcript-ready" }
  | { type: "transcribe-failed"; reason: string }
  | { type: "dismiss-error" };

export const INITIAL_PUSH_TO_TALK_STATE: PushToTalkState = { status: "idle" };

type TransitionKey = `${PushToTalkStatus}:${PushToTalkEvent["type"]}`;

/**
 * One entry per legal transition, keyed by `"<currentStatus>:<eventType>"`. Any key not present
 * here means "ignore this event in this state" (e.g. a stray `stop` while idle, or a second
 * `start` while already recording) — {@link nextPushToTalkState} falls back to the unchanged
 * state rather than throwing, since a race between a fast double-press and an in-flight async step
 * is a real possibility, not a bug to crash on.
 *
 * The `as` casts below are safe: each key already pins down exactly which event shape reaches its
 * handler (e.g. only `"requesting-mic:mic-denied"` maps to the handler reading `.reason`), which
 * TypeScript cannot see through a plain string-keyed record but {@link nextPushToTalkState}'s own
 * lookup guarantees.
 */
/** Builds the `"error"` state, shared by both failure transitions below. */
function errorState(event: PushToTalkEvent): PushToTalkState {
  return { status: "error", errorReason: (event as { reason: string }).reason };
}

const TRANSITIONS: Partial<Record<TransitionKey, (event: PushToTalkEvent) => PushToTalkState>> = {
  "idle:start": () => ({ status: "requesting-mic" }),
  "requesting-mic:mic-granted": () => ({ status: "recording" }),
  "requesting-mic:mic-denied": errorState,
  // The hold ended before the permission prompt resolved — see `PushToTalkStatus`'s own doc on
  // `"cancelling"` for why this can't go straight to `"idle"`: `mic-granted`/`mic-denied` are
  // still coming, asynchronously, and the machine has to be somewhere that tells `usePushToTalk`
  // to release the mic instead of starting to record it.
  "requesting-mic:stop": () => ({ status: "cancelling" }),
  "recording:stop": () => ({ status: "transcribing" }),
  "transcribing:transcript-ready": () => ({ status: "idle" }),
  "transcribing:transcribe-failed": errorState,
  "error:dismiss-error": () => ({ status: "idle" }),
  "error:start": () => ({ status: "requesting-mic" }),
  // Permission finally settled after the hold already ended. Neither outcome starts a recording
  // nor shows an error — nobody is watching this prompt anymore.
  "cancelling:mic-granted": () => ({ status: "idle" }),
  "cancelling:mic-denied": () => ({ status: "idle" }),
};

/**
 * Advances the state machine by one event. Table-driven rather than a nested switch, so adding a
 * transition never raises this function's own branching — it stays a single lookup regardless of
 * how many states/events exist.
 *
 * @complexity Time/space: O(1).
 */
export function nextPushToTalkState(state: PushToTalkState, event: PushToTalkEvent): PushToTalkState {
  const transition = TRANSITIONS[`${state.status}:${event.type}`];
  return transition ? transition(event) : state;
}

export interface PushToTalkIndicator {
  /** English copy, doubling as its own i18n key per this repo's convention — the caller passes it
   *  through `t()`. */
  label: string;
  /** `"assertive"` only while recording or on failure — states the user must not miss even if
   *  looking elsewhere; `"polite"` for the rest. */
  ariaLive: "polite" | "assertive";
  /** Drives the unmistakable recording indicator (pulsing dot, red state) — `true` in exactly one
   *  state, `"recording"`, never inferred from any other field. */
  isRecording: boolean;
}

/**
 * Maps a state to what the user should see and hear (via `aria-live`) — the single source of truth
 * for "is the mic live right now," so the indicator can never drift from the state machine that
 * actually owns the microphone.
 *
 * @complexity Time/space: O(1).
 */
const PUSH_TO_TALK_INDICATORS: Record<Exclude<PushToTalkStatus, "error">, PushToTalkIndicator> = {
  idle: { label: "Hold to talk", ariaLive: "polite", isRecording: false },
  "requesting-mic": { label: "Requesting microphone…", ariaLive: "polite", isRecording: false },
  recording: { label: "Recording — release to send", ariaLive: "assertive", isRecording: true },
  transcribing: { label: "Transcribing…", ariaLive: "polite", isRecording: false },
  // The hold is already over from the user's own point of view (they released the button) —
  // same resting copy as `"idle"`, not a distinct "cancelling…" message nobody would be
  // holding still long enough to read.
  cancelling: { label: "Hold to talk", ariaLive: "polite", isRecording: false },
};

export function describePushToTalkIndicator(state: PushToTalkState): PushToTalkIndicator {
  if (state.status === "error") {
    return { label: state.errorReason ?? "Voice input failed", ariaLive: "assertive", isRecording: false };
  }
  // A fresh object per call, as the switch this replaced returned.
  return { ...PUSH_TO_TALK_INDICATORS[state.status] };
}
