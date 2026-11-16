---
"@jini-ai/cms": patch
---

Form attachment reconciliation reports `detail` for an inspection, protection or cleanup failure; a failed attachment-cleanup job keeps its cause on the `FormDeliveryError` (its public text stays the bare code); a failed free-disk check logs its error; an invalid form-destination file and a failed video-workspace cleanup say what failed; a redirect origin lookup failure carries `detail`.
