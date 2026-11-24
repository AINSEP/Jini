import { describe, expect, it } from "vitest";

import { NO_DESKTOP_SHELL_REASON, describeVoiceUnavailability } from "../voice-unavailability.js";

/**
 * @file Every reason code the transcription port can actually emit, mapped to the line an operator
 * sees. The codes here are not invented for the test — each one is produced by
 * the host desktop shell's transcription port or its speech helper; see
 * `voice-unavailability.ts`'s own header for the provenance of each.
 */

describe("describeVoiceUnavailability", () => {
  it("names the desktop app when there is no bridge at all", () => {
    expect(describeVoiceUnavailability({ appName: "Acme", reason: NO_DESKTOP_SHELL_REASON })).toBe(
      "Voice input needs the Acme desktop app — transcription runs on your Mac, never in the cloud.",
    );
  });

  it("strips the platform detail off unsupported-platform, which an operator cannot act on", () => {
    const copy = "Voice input needs macOS — on-device transcription is not available here.";
    expect(describeVoiceUnavailability({ appName: "Acme", reason: "unsupported-platform:win32" })).toBe(copy);
    expect(describeVoiceUnavailability({ appName: "Acme", reason: "unsupported-platform:linux" })).toBe(copy);
  });

  it("strips the authorization status detail the same way", () => {
    expect(describeVoiceUnavailability({ appName: "Acme", reason: "speech-recognition-not-authorized:denied" })).toBe(
      "Acme is not allowed to use speech recognition. Grant it in System Settings › Privacy & Security.",
    );
  });

  it("points at Dictation when the on-device assets are simply not installed", () => {
    expect(describeVoiceUnavailability({ appName: "Acme", reason: "on-device-recognition-unavailable" })).toBe(
      "macOS on-device dictation is not installed. Turn it on in System Settings › Keyboard › Dictation.",
    );
  });

  it("covers the remaining helper-side codes", () => {
    expect(describeVoiceUnavailability({ appName: "Acme", reason: "no-recognizer-for-locale" })).toBe(
      "macOS has no on-device recognizer for this language.",
    );
    expect(describeVoiceUnavailability({ appName: "Acme", reason: "swiftc-not-found: no Swift toolchain on this machine" })).toBe(
      "Voice input needs Xcode command line tools (no Swift toolchain found).",
    );
    expect(describeVoiceUnavailability({ appName: "Acme", reason: "swiftc-failed: error: cannot find 'Speech'" })).toBe(
      "The speech helper failed to build on this machine.",
    );
  });

  it("falls back rather than leaking an unmapped internal string into the tooltip", () => {
    const fallback = "Voice input is not available on this machine.";
    expect(describeVoiceUnavailability({ appName: "Acme", reason: undefined })).toBe(fallback);
    expect(describeVoiceUnavailability({ appName: "Acme", reason: "EPIPE: broken pipe at ipcRenderer.invoke" })).toBe(fallback);
  });

  it("matches by prefix, not by substring — a code that merely mentions a known one falls back", () => {
    // Guards against a `.includes` regression that would map an unrelated failure onto reassuring
    // copy about a different cause.
    expect(describeVoiceUnavailability({ appName: "Acme", reason: "ipc-failed:on-device-recognition-unavailable" })).toBe(
      "Voice input is not available on this machine.",
    );
  });
});
