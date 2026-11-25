---
"@jini-ai/admin": minor
---

Media card upload dates show the owner's local calendar day instead of the UTC day: `formatUploadDate` and `useMediaCardMetadata` accept an injected IANA `timeZone` (default: the runtime's zone).
