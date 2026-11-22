---
"@jini-ai/cms": patch
---

`safeMediaProvenance` again reads a URL origin's `url` inside its validation `try`, so a throwing accessor yields `MediaValidationError` instead of the accessor's own error.
