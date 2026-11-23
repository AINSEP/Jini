---
"@jini-ai/http-kit": patch
---

A JSON route whose success status is 204, 205 or 304 now ends the response with no body instead of serializing through `res.json`.
