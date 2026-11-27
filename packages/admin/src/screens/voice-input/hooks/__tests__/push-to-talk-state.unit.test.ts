import { describe, expect, it } from "vitest";

import { describePushToTalkIndicator, INITIAL_PUSH_TO_TALK_STATE, nextPushToTalkState, type PushToTalkEvent, type PushToTalkState, type PushToTalkStatus } from "../push-to-talk-state.hooks.js";
import { VOICE_INPUT_ENABLED } from "../../voice-input-config.js";

const at = (status: PushToTalkStatus): PushToTalkState => ({ status });
const run = (events: PushToTalkEvent[]) => events.reduce(nextPushToTalkState, INITIAL_PUSH_TO_TALK_STATE);

describe("push-to-talk state machine", () => {
  it("walks a full hold: request, grant, record, stop, transcribe, back to idle", () => {
    expect(run([{ type: "start" }])).toEqual({ status: "requesting-mic" });
    expect(run([{ type: "start" }, { type: "mic-granted" }])).toEqual({ status: "recording" });
    expect(run([{ type: "start" }, { type: "mic-granted" }, { type: "stop" }])).toEqual({ status: "transcribing" });
    expect(run([{ type: "start" }, { type: "mic-granted" }, { type: "stop" }, { type: "transcript-ready" }])).toEqual({ status: "idle" });
  });

  it("carries the reason into the error state for a denied mic and a failed transcription", () => {
    expect(nextPushToTalkState(at("requesting-mic"), { type: "mic-denied", reason: "blocked" })).toEqual({ status: "error", errorReason: "blocked" });
    expect(nextPushToTalkState(at("transcribing"), { type: "transcribe-failed", reason: "no speech" })).toEqual({ status: "error", errorReason: "no speech" });
  });

  it("leaves the error state by dismissing it or by starting a new hold", () => {
    const failed: PushToTalkState = { status: "error", errorReason: "blocked" };
    expect(nextPushToTalkState(failed, { type: "dismiss-error" })).toEqual({ status: "idle" });
    expect(nextPushToTalkState(failed, { type: "start" })).toEqual({ status: "requesting-mic" });
  });

  it("parks a hold released during the prompt in cancelling, which returns to idle whatever the prompt answers", () => {
    const cancelling = nextPushToTalkState(at("requesting-mic"), { type: "stop" });
    expect(cancelling).toEqual({ status: "cancelling" });
    expect(nextPushToTalkState(cancelling, { type: "mic-granted" })).toEqual({ status: "idle" });
    expect(nextPushToTalkState(cancelling, { type: "mic-denied", reason: "late" })).toEqual({ status: "idle" });
  });

  it("ignores an event that is not legal in the current state, returning the same state object", () => {
    const recording = at("recording");
    expect(nextPushToTalkState(recording, { type: "start" })).toBe(recording);
    const idle = at("idle");
    expect(nextPushToTalkState(idle, { type: "stop" })).toBe(idle);
  });
});

describe("push-to-talk indicator", () => {
  it("is loud and live only while recording", () => {
    expect(describePushToTalkIndicator(at("recording"))).toEqual({ label: "Recording — release to send", ariaLive: "assertive", isRecording: true });
    expect(describePushToTalkIndicator(at("requesting-mic"))).toEqual({ label: "Requesting microphone…", ariaLive: "polite", isRecording: false });
    expect(describePushToTalkIndicator(at("transcribing"))).toEqual({ label: "Transcribing…", ariaLive: "polite", isRecording: false });
    expect(describePushToTalkIndicator(at("cancelling"))).toEqual({ label: "Hold to talk", ariaLive: "polite", isRecording: false });
  });

  it("returns a fresh object per call, so a caller's edit never leaks into the next state's indicator", () => {
    const first = describePushToTalkIndicator(at("idle"));
    first.label = "edited";
    expect(describePushToTalkIndicator(at("idle")).label).toBe("Hold to talk");
  });

  it("announces the error reason assertively, with honest copy when no reason was given", () => {
    expect(describePushToTalkIndicator({ status: "error", errorReason: "blocked" })).toEqual({ label: "blocked", ariaLive: "assertive", isRecording: false });
    expect(describePushToTalkIndicator(at("error"))).toEqual({ label: "Voice input failed", ariaLive: "assertive", isRecording: false });
  });
});

describe("voice input switch", () => {
  // Owner ruling 2026-09-13 / 2026-10-30: the composer mounts no mic button until this flag is flipped back.
  it("keeps the push-to-talk button unmounted", () => {
    expect(VOICE_INPUT_ENABLED).toBe(false);
  });
});
