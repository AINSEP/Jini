---
"@jini-ai/daemon": minor
---

The attachment lookup route is returned as data: `attachmentLookupRoutes({ store, host }, { onInternalError })` replaces `registerAttachmentLookupRoutes` (removed, no alias). The route reads its own JSON body (64 KB at most; over that answers 413) instead of bringing an Express parser. The host's bearer gate stays in front of wherever the list is mounted.
