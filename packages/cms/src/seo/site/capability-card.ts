/** Minimal SEO learning card, maintained beside its owning code. Live registries supply current types. */
import type { GuideTopic as CapabilityCard } from "@jini-ai/core/contracts/site/agentic-core";

export const capabilityCard = {
  "id": "seo",
  "title": "SEO",
  "summary": "Site defaults and per-entry metadata shape search and sharing.",
  "explanation": "Inspect resolved entry metadata and existing defaults before changing titles, canonical URLs or social previews.",
  "permissions": [
    "admin.seo.manage"
  ],
  "pointers": [
    {
      "label": "Inspect seo",
      "tool": "seo_get_settings",
      "permissions": [
        "admin.seo.manage"
      ]
    },
    {
      "label": "SEO admin",
      "href": "/admin/seo",
      "permissions": [
        "admin.seo.manage"
      ]
    }
  ],
  "workflows": []
} as const satisfies CapabilityCard;
