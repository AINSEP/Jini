/** Minimal Members learning card, maintained beside its owning code. Live registries supply current types. */
/** The read pointer is a `{{read:member}}` placeholder: the host resolves it through its `HostReadVocabulary` (`resolveHostReadRefs`), since the engine may not name a host tool id. */
import type { GuideTopic as CapabilityCard } from "@jini-ai/core/contracts/site/agentic-core";

export const capabilityCard = {
  "id": "members",
  "title": "Members",
  "summary": "Member sign-in, profiles and content access are separate from operator accounts.",
  "explanation": "The host has no membership enable/disable toggle, so the enabled fact is unavailable. Member sessions and admin sessions are separate; never infer member access from an admin role.",
  "permissions": [
    "member.manage"
  ],
  "pointers": [
    {
      "label": "Inspect members",
      "tool": "{{read:member}}",
      "permissions": [
        "member.manage"
      ]
    },
    {
      "label": "Members admin",
      "href": "/admin/members",
      "permissions": [
        "member.manage"
      ]
    }
  ],
  "workflows": []
} as const satisfies CapabilityCard;
