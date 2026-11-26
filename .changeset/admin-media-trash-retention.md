---
"@jini-ai/core": patch
"@jini-ai/cms": patch
"@jini-ai/admin": patch
---

Expose the current Trash page-one retention policy through the required `GridPages.retentionDays` hook-return field, including empty first pages, and hide card countdowns outside Trash while retaining previous rows during loading.

The media grid route requires the `clock`, `retentionDays`, and `readTrashDeadlines` ports. Grid pages carry the optional `retentionDays` and per-row `trashDaysRemaining` fields. Media cards require `showTrashCountdown`; existing export paths are unchanged.
