import type { PublicAssistantSettings } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";

/**
 * @file Everything the Visitor tab's layout decides (2026-10-09 redesign): the status pill, whether
 * the enable switch may turn ON, and the widget choice. The credential form keeps its own hook
 * (`use-visitor-credential-form.hooks.ts`); this one only reads that form's `hasStoredKey`.
 */

/** The Visitor tab's status pill: what visitors get right now. */
export type VisitorAssistantStatus = "on" | "off" | "needs-key";

/**
 * The Visitor tab's status pill and enable-switch gate (2026-10-09 redesign).
 *
 * "Needs a key" wins over the switch's own value: an enabled assistant with no stored key is
 * mounted but cannot answer, which is exactly the silent failure this tab exists to surface.
 * The switch can always be turned OFF; it can only be turned ON once a key is saved.
 *
 * @complexity Time/space: O(1).
 */
export function visitorAssistantStatus(required: { publicEnabled: boolean; hasStoredKey: boolean }, _optional = {}): {
  status: VisitorAssistantStatus; canEnable: boolean;
} {
  const enabledStatus: VisitorAssistantStatus = required.publicEnabled ? "on" : "off";
  const status: VisitorAssistantStatus = required.hasStoredKey ? enabledStatus : "needs-key";
  return { status, canEnable: required.hasStoredKey || required.publicEnabled };
}

/** The pill's label and its one short hint line, per status (English keys; the view runs `t`). */
export const VISITOR_STATUS_COPY: Record<VisitorAssistantStatus, { label: string; hint: string }> = {
  on: { label: "On", hint: "Visitors can chat with it on every public page." },
  off: { label: "Off", hint: "Visitors see no assistant." },
  "needs-key": { label: "Needs a key", hint: "Save a key in step 1 first." },
};

/** The host's widget writer (its assistant-settings controller's `setWidget`). */
export type SetVisitorWidget = (input: { widget: "react" | "vanilla" }, options?: Record<string, never>) => Promise<void>;

export interface VisitorAssistantPanelController {
  status: VisitorAssistantStatus;
  /** English keys for the pill and its hint line; the view translates them. */
  statusCopy: { label: string; hint: string };
  /** False while no key is saved and the assistant is off: the switch cannot turn ON yet. */
  canEnable: boolean;
  /** The reason under a disabled switch, or `null` when it is usable. */
  enableBlockedReason: string | null;
  /** The ⓘ text beside the switch: what the CURRENT state means for visitors. */
  enableInfo: string;
  widget: "react" | "vanilla";
  /** The widget `<select>`'s change handler; any value but `"vanilla"` means the standard widget. */
  chooseWidget: (required: { value: string }, optional?: Record<string, never>) => void;
}

/**
 * @param required.settings - The loaded public settings.
 * @param required.hasStoredKey - The credential form's `hasStoredKey`: a key is saved on the server.
 * @param required.setWidget - The host controller's `setWidget`.
 * @complexity Time/space: O(1).
 */
export function useVisitorAssistantPanel(
  required: { settings: PublicAssistantSettings; hasStoredKey: boolean; setWidget: SetVisitorWidget },
  _optional: Record<string, never> = {},
): VisitorAssistantPanelController {
  const { settings, hasStoredKey, setWidget } = required;
  const { status, canEnable } = visitorAssistantStatus({ publicEnabled: settings.publicEnabled, hasStoredKey });
  return {
    status,
    statusCopy: VISITOR_STATUS_COPY[status],
    canEnable,
    enableBlockedReason: canEnable ? null : "Save a key in step 1 first.",
    enableInfo: settings.publicEnabled
      ? "Visitors can chat with it on every public page."
      : "When off, your site loads no assistant code and has no chat endpoint.",
    widget: settings.widget ?? "react",
    chooseWidget: ({ value }, _options: Record<string, never> = {}) => void setWidget({ widget: value === "vanilla" ? "vanilla" : "react" }),
  };
}
