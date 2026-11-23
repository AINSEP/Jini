import { reportShellFailure } from "./shell-failure-log.js";
/**
 * @file The consent/announcement signal for `admin.capture_screenshot`.
 *
 * ## Why this exists — the privacy decision behind it
 *
 * `admin.capture_screenshot`'s tool result is a picture of everything currently rendered in
 * `<main>` (`lib/agent-screenshot.ts`) — a materially larger blast radius than the existing
 * `page.*` verbs, which only ever report text/attributes an author deliberately opted into via
 * `data-agent-element`. A screenshot has no such opt-in granularity: an unmasked field value, a
 * secret mid-paste, or another admin's data rendered on screen is captured exactly as it appears,
 * whether or not anyone tagged it as agent-visible.
 *
 * The capability is still allowed by default (gating it behind a settings toggle the operator must
 * find and enable first would reproduce the exact manual-screenshot friction it exists to remove —
 * the operator already asked the assistant, in this same chat, to look at their screen). What this
 * bus buys instead is that a capture is never SILENT: the instant `agent-screenshot.ts` captures
 * anything, it calls {@link publishScreenshotCaptured}, and `App.tsx` renders a `<Toast>` naming
 * what just happened. This is "announced in the UI," not "gated by a setting" — see that file's own
 * module doc for the full option comparison. No settings-based opt-out was built in this slice;
 * a compliance-sensitive deployment wanting one is future work, not silently assumed unnecessary.
 *
 * ## Why a bus rather than a prop
 *
 * The publisher is the host admin app's `useAgentPageBridge` hook — an effect with no relationship to
 * `App.tsx`'s own render body beyond the `agentBridge` it already returns, which carries no signal
 * for "a capability just executed." Threading one through would grow that return type for a single
 * consumer. Modeled directly on `settings-refresh-bus.ts`: fire-and-forget, no payload, because the
 * subscriber renders a fixed, already-translated message rather than anything the publisher could
 * supply that a static string does not already say.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * Registers `listener`, called with no arguments every time a screenshot is captured.
 *
 * @returns A disposer; call it from the subscriber's effect cleanup. A listener that outlives its
 * component would set state on an unmounted one.
 * @complexity O(1).
 */
export function subscribeToScreenshotCaptured({ listener }: { listener: Listener }, _optional: Record<string, never> = {}): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Notifies every subscriber that `admin.capture_screenshot` just captured this admin's screen.
 *
 * Never throws: a listener that throws is logged and the remaining listeners still run, matching
 * `settings-refresh-bus.ts`'s `publishSettingsRefresh` — the publisher is capture/executor code with
 * no sensible way to handle one toast's rendering failure, and one broken subscriber must not
 * suppress the announcement to any other.
 *
 * @complexity O(n) in the listener count.
 */
export function publishScreenshotCaptured(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      reportShellFailure({ message: "[admin] screenshot-captured listener failed", error });
    }
  }
}

/** Test seam — drops every listener. Not used in production code. */
export function resetScreenshotCapturedBus(): void {
  listeners.clear();
}
