import type { CapabilityCard } from "../contracts/capability-card.js";

/** What the host binds into the Forms card: its permission id, inspect tool name and admin screen. */
export interface FormsCapabilityCardHost {
  readonly permission: string;
  readonly inspectTool: string;
  readonly adminHref: string;
}

/** Minimal Forms learning card, maintained beside its owning code. Live registries supply current types. */
export function createFormsCapabilityCard({ host }: { host: FormsCapabilityCardHost }, _options: Record<string, never> = {}) {
  return {
    "id": "forms",
    "title": "Forms",
    "summary": "Collect submissions with native form definitions and rendered embeds.",
    "explanation": "Ask for the live fieldTypes before choosing fields. HTML-authored forms and definition-based forms have different authoring contracts; consult the forms tools for the supported schema.",
    "permissions": [host.permission],
    "pointers": [
      { "label": "Inspect forms", "tool": host.inspectTool, "permissions": [host.permission] },
      { "label": "Forms admin", "href": host.adminHref, "permissions": [host.permission] },
    ],
    "workflows": [],
  } as const satisfies CapabilityCard;
}
