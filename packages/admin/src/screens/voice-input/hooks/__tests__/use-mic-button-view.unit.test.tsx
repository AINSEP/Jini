// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useMicButtonView, type MicButtonViewInput } from "../mic-button-view.hooks.js";
import { describePushToTalkIndicator } from "../push-to-talk-state.hooks.js";

const idle = describePushToTalkIndicator({ status: "idle" });
const recording = describePushToTalkIndicator({ status: "recording" });

describe("useMicButtonView", () => {
  it("keeps the same view object across re-renders with unchanged inputs and derives a new one when they change", () => {
    const hook = renderHook((input: MicButtonViewInput) => useMicButtonView(input), { initialProps: { available: true, indicator: idle, unavailableReason: undefined } });
    const first = hook.result.current;
    expect(first).toMatchObject({ label: "Hold to talk", disabled: false, isRecording: false });

    hook.rerender({ available: true, indicator: idle, unavailableReason: undefined });
    expect(hook.result.current).toBe(first);

    hook.rerender({ available: true, indicator: recording, unavailableReason: undefined });
    expect(hook.result.current).toMatchObject({ label: "Recording — release to send", isRecording: true, ariaLive: "assertive" });
    expect(hook.result.current).not.toBe(first);
  });

  it("follows availability: nothing while probing, a disabled button with the reason when unavailable", () => {
    const hook = renderHook((input: MicButtonViewInput) => useMicButtonView(input), { initialProps: { available: null, indicator: idle, unavailableReason: undefined } as MicButtonViewInput });
    expect(hook.result.current).toBeNull();
    hook.rerender({ available: false, indicator: idle, unavailableReason: "No microphone" });
    expect(hook.result.current).toMatchObject({ label: "No microphone", disabled: true, isRecording: false });
  });
});
