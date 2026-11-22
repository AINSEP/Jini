/** Translate Electron guest callbacks while preserving the host's missing-preload diagnostic. */
import {
  admitGuestSource as admitSource,
  applyGuestWebPreferences as applyPreferences,
} from "../electron/navigation-policy/index.js";
import type { GuestPolicyOptions, GuestWebPreferences } from "../electron/navigation-policy/index.js";

interface GuestSourceOptions {
  // Guest policy rationale: Jini/packages/desktop-host/src/electron/navigation-policy/webview-guest-policy.ts.
  isAllowedSource: (required: { src: string }) => boolean;
}

/** Apply Jini isolation policy with the shell's required preload. Mutates preferences. @complexity O(1). */
function applyGuestWebPreferences(
  { webPreferences, options }: { webPreferences: GuestWebPreferences; options: GuestPolicyOptions }, _optional = {},
): void {
  // D-10: deleting preload made the ordinary embedded admin tab report no desktop voice capability,
  // even though standalone windows worked. Grant the shell's required preload to both surfaces.
  if (typeof options?.preloadPath !== "string" || options.preloadPath.length === 0) {
    throw new Error("applyGuestWebPreferences: options.preloadPath is required — a guest with no preload has no voice API.");
  }
  applyPreferences({ webPreferences, preloadPath: options.preloadPath });
}

/** Adapt the Electron event and host predicate; failures refuse attachment. @complexity O(1) beyond the predicate. */
function admitGuestSource(
  { event, params, options }: { event: { preventDefault(): void }; params: { src?: unknown }; options: GuestSourceOptions }, _options = {},
): boolean {
  return admitSource({ event, params, isAllowedSource: options.isAllowedSource });
}

export { applyGuestWebPreferences, admitGuestSource };
export type { GuestPolicyOptions, GuestWebPreferences, GuestSourceOptions };
