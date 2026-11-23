---
"@jini-ai/desktop-host": patch
---

Caught errors reach the host raw instead of being turned into text inside Jini (log-safety): `createUpdateCheckNow` takes a required `describeErrorMessage` (the `updateErrorMessage` export is removed; hosts keep their own), `exchangeSessionJson` / `exchangeSessionRequest` take a required `describeError`, and `applyDockIcon`'s `reportFailure` receives `{ error }`. These APIs were added in this same unreleased batch.
