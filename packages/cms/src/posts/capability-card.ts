import type { CapabilityCard } from "../contracts/capability-card.js";

/** What the host binds into the Content card: its permission id, inspect tool name and admin screen. */
export interface ContentCapabilityCardHost {
  readonly permission: string;
  readonly inspectTool: string;
  readonly adminHref: string;
}

/** Minimal Content learning card, maintained beside its owning code. Live registries supply current types. */
export function createContentCapabilityCard({ host }: { host: ContentCapabilityCardHost }, _options: Record<string, never> = {}) {
  return {
    "id": "content",
    "title": "Content",
    "summary": "Pages, posts and structured collections are reusable site data.",
    "explanation": "Create content through the content tools; attach forms and widgets rather than embedding a second implementation.",
    "permissions": [host.permission],
    "pointers": [
      { "label": "Inspect content", "tool": host.inspectTool, "permissions": [host.permission] },
      { "label": "Content admin", "href": host.adminHref, "permissions": [host.permission] },
    ],
    "workflows": [],
  } as const satisfies CapabilityCard;
}
