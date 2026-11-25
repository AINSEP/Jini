/**
 * @file Everything the mic button renders, derived in one pure place so `PushToTalkMicButton.tsx`
 * stays declarative — this app's standing rule that no derived logic lives in a `.tsx` body.
 *
 * **Why the unavailable state renders at all.** The first cut of this feature rendered nothing
 * outside the desktop shell, on the reasoning that a disabled control "implies voice input almost
 * works". In practice a control that simply is not there reads as a missing feature and invites the
 * obvious follow-up question, so the button now renders disabled with the real reason attached. It
 * still renders nothing while the availability probe is in flight — that window is a few
 * milliseconds and flashing an unavailable state that immediately corrects itself is worse than
 * showing nothing.
 */

import { useMemo } from "react";

import type { PushToTalkIndicator } from "./push-to-talk-state.hooks.js";

const BASE_CLASS = "jini-push-to-talk";

export interface MicButtonView {
  className: string;
  /** English copy, doubling as its own i18n key per this app's convention — the caller passes it
   *  through `t()`. Serves as both the accessible name and the tooltip. */
  label: string;
  disabled: boolean;
  ariaLive: "polite" | "assertive";
  /** Drives the pulsing recording dot. Never true in the unavailable state. */
  isRecording: boolean;
}

export interface MicButtonViewInput {
  /** `null` while the availability probe is in flight. */
  available: boolean | null;
  indicator: PushToTalkIndicator;
  /** Present exactly when `available === false`; see `voice-unavailability.ts`. */
  unavailableReason: string | undefined;
}

/**
 * Resolves the button's rendered shape, or `null` when nothing should render at all.
 *
 * @returns `null` only during the in-flight probe (`available === null`).
 * @complexity Time/space: O(1).
 */
export function resolveMicButtonView(input: MicButtonViewInput): MicButtonView | null {
  if (input.available === null) return null;
  if (!input.available) {
    return {
      className: `${BASE_CLASS} ${BASE_CLASS}--unavailable`,
      // Falls back only if a caller hands an unavailable state with no reason at all; the hook that
      // produces this always supplies one.
      label: input.unavailableReason ?? "Voice input is not available on this machine.",
      disabled: true,
      ariaLive: "polite",
      isRecording: false,
    };
  }
  return {
    className: input.indicator.isRecording ? `${BASE_CLASS} ${BASE_CLASS}--recording` : BASE_CLASS,
    label: input.indicator.label,
    disabled: false,
    ariaLive: input.indicator.ariaLive,
    isRecording: input.indicator.isRecording,
  };
}

/**
 * Hook wrapper over {@link resolveMicButtonView}, so the component body holds no derived logic of
 * its own and the object identity is stable between unrelated re-renders.
 *
 * @complexity Time/space: O(1).
 */
export function useMicButtonView(input: MicButtonViewInput): MicButtonView | null {
  const { available, indicator, unavailableReason } = input;
  return useMemo(
    () => resolveMicButtonView({ available, indicator, unavailableReason }),
    [available, indicator, unavailableReason],
  );
}
