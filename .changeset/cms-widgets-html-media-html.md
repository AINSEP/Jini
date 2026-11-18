---
"@jini-ai/cms": minor
---

Add `sanitizePageHtml` and `renderMediaRawHtml` to `@jini-ai/cms/widgets/html`: the parser-backed page-body policy and the media Raw HTML resolver. Diagnostics (dropped markup, unknown media slug, element/media kind mismatch) go to an injected `report({ code, detail })`; with no `report` they are silent.
