import { useSyncExternalStore } from "react";

import { getAssistantDockOpen, requestAssistantDock, subscribeToAssistantDock } from "../../shell/lib/assistant-dock-bus.js";

/**
 * @file State for `AdminAssistantSwitch` — whether the admin's own assistant dock is open.
 *
 * `useSyncExternalStore` rather than `useState` + an effect: the dock can be toggled by the FAB, by
 * Escape, or by this control, and a local copy would drift out of date the moment one of the other
 * two won. A checkbox that misreports whether the panel is open is worse than no checkbox. Moved
 * verbatim from `AdminAssistantSwitch`'s component body.
 */

export interface AdminAssistantSwitchController {
  open: boolean;
  setOpen: (required: { open: boolean }, optional?: Record<string, never>) => void;
}

/**
 * `AdminAssistantSwitch`'s own state — whether the admin's own assistant dock is open, read live off
 * the shared dock bus rather than duplicated local state (see this file's own header for why).
 *
 * No I/O, so no injectable port: the whole hook has nothing to inject, and `AdminAssistantSwitch` takes
 * the hook itself as its DI seam (the REQUIRED `useAdminAssistantSwitchHook` prop, normally this function) rather
 * than threading a dependencies object through it.
 *
 * @returns The dock's current open state and the setter that requests a change.
 * @complexity Time/space: O(1) — one external-store subscription, no iteration.
 */
export function useAdminAssistantSwitch(): AdminAssistantSwitchController {
  const open = useSyncExternalStore(subscribeToAssistantDock, getAssistantDockOpen, () => false);
  return { open, setOpen: requestAssistantDock };
}
