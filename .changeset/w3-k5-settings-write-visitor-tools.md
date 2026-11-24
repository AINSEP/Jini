---
"@jini-ai/cms": minor
---

Add `@jini-ai/cms/settings/site/{site-title-write,form-delivery-write,mail-provider,tool-deps,chat-execution-write,publish-content,visitor-tools-*}`: the settings write chokepoint (required `writePolicies`), its writers, visitor-tools management (required `visitorTools` host contract) and the site-setting publish contribution. `site-title` failures now reach required reporters (`reportSiteTitleFailure`, `reportPreservationSummary`) with a fixed message and error class instead of being logged with the raw exception text.
