import type { CapabilityCard } from "../contracts/capability-card.js";

/** What the host binds into the Widgets card: its permission id, inspect tool names and admin screen. */
export interface WidgetsCapabilityCardHost {
  readonly permission: string;
  readonly inspectInstancesTool: string;
  readonly inspectRegionsTool: string;
  readonly adminHref: string;
}

/** Minimal Widgets learning card, maintained beside its owning code. Live registries supply current types. */
export function createWidgetsCapabilityCard({ host }: { host: WidgetsCapabilityCardHost }, _options: Record<string, never> = {}) {
  return {
    "id": "widgets",
    "title": "Widgets",
    "summary": "Reusable widgets appear inline or in theme regions.",
    "explanation": "Discover widget types and region placements before building a custom block. Widget instances reuse existing content and form definitions.",
    "permissions": [host.permission],
    "pointers": [
      { "label": "Inspect widgets", "tool": host.inspectInstancesTool, "permissions": [host.permission] },
      { "label": "Inspect regions", "tool": host.inspectRegionsTool, "permissions": [host.permission] },
      { "label": "Widgets admin", "href": host.adminHref, "permissions": [host.permission] },
    ],
    "workflows": [],
  } as const satisfies CapabilityCard;
}
