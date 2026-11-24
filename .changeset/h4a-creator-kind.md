---
"@jini-ai/cms": minor
"@jini-ai/user-management": minor
---

Record who created a post or newsletter campaign at write time: `PostRecord.createdByKind` and `CampaignRecord.createdByKind` (`"person" | "agent"`), write-once, plus an optional `creatorKind` on `saveCampaign`. `createdByKind` is excluded from the post content hash.
