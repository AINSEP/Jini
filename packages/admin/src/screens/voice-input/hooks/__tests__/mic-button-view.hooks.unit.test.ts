import { describe, expect, it } from "vitest";

import { resolveMicButtonView } from "../mic-button-view.hooks.js";
import { describePushToTalkIndicator } from "../push-to-talk-state.hooks.js";

/**
 * @file Direct assertions on what the mic button renders in each availability state. The rendered
 * output that consumes this is covered in `__tests__/PushToTalkMicButton.unit.test.tsx`; this file
 * pins the mapping itself, including the states that file can only reach indirectly.
 */

const idleIndicator = describePushToTalkIndicator({ status: "idle" });
const recordingIndicator = describePushToTalkIndicator({ status: "recording" });

describe("resolveMicButtonView", () => {
  it("renders nothing at all while the probe is in flight", () => {
    // Not an unavailable button: flashing "unavailable" for a few ms and then correcting itself is
    // worse than showing nothing.
    expect(resolveMicButtonView({ available: null, indicator: idleIndicator, unavailableReason: undefined })).toBeNull();
  });

  it("renders a disabled, muted, non-recording button carrying the reason when unavailable", () => {
    const view = resolveMicButtonView({
      available: false,
      indicator: idleIndicator,
      unavailableReason: "Voice input needs the Tovu desktop app.",
    });

    expect(view).toEqual({
      className: "jini-push-to-talk jini-push-to-talk--unavailable",
      label: "Voice input needs the Tovu desktop app.",
      disabled: true,
      ariaLive: "polite",
      isRecording: false,
    });
  });

  it("never shows the recording state on an unavailable button, whatever the indicator says", () => {
    // The indicator is driven by a state machine that cannot run while unavailable, but a stale or
    // racing value must not be able to paint a live-mic affordance on a dead control.
    const view = resolveMicButtonView({
      available: false,
      indicator: recordingIndicator,
      unavailableReason: "unavailable",
    });

    expect(view?.isRecording).toBe(false);
    expect(view?.className).not.toContain("--recording");
  });

  it("falls back to honest copy if an unavailable state arrives with no reason at all", () => {
    const view = resolveMicButtonView({ available: false, indicator: idleIndicator, unavailableReason: undefined });
    expect(view?.label).toBe("Voice input is not available on this machine.");
  });

  it("renders the plain enabled button when idle and available", () => {
    expect(resolveMicButtonView({ available: true, indicator: idleIndicator, unavailableReason: undefined })).toEqual({
      className: "jini-push-to-talk",
      label: "Hold to talk",
      disabled: false,
      ariaLive: "polite",
      isRecording: false,
    });
  });

  it("carries the loud recording state through unchanged", () => {
    expect(resolveMicButtonView({ available: true, indicator: recordingIndicator, unavailableReason: undefined })).toEqual({
      className: "jini-push-to-talk jini-push-to-talk--recording",
      label: "Recording — release to send",
      disabled: false,
      // Assertive while the mic is live: a state the operator must not miss even if looking away.
      ariaLive: "assertive",
      isRecording: true,
    });
  });
});
