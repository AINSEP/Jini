---
"@jini-ai/cms": patch
---

Add `@jini-ai/cms/publish/content/dialog` (+ `/contract`, `/criteria`, `/phase`, `/publish-order`, `/replan`, `/report-rows`, `/report-reasons`): the publish dialog's pure semantics (report rows, owner-facing skip reasons, criteria, phase gates, re-plan drift check), shared by a browser dialog and a server-side publish tool. `toPublishReportRows({ report, entityTypeLabel })` and `preparePublishConfirmation({ …, entityTypeLabel })` take an injected labeler because the section table is host copy.
