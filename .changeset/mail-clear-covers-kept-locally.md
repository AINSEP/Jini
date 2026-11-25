---
"@jini-ai/platform": minor
---

Clearing captured test emails now covers every row the Activity list shows as kept locally, including console-driver sends that store no copy: `reviewCaptured` also returns `attemptIds`, and `clearReviewedCaptures` takes them (breaking for direct callers), deletes only still-captured attempts and retires their ledger rows from the activity projection.
