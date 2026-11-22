---
"@jini-ai/core": patch
---

`readJsonBody` applies the compressed-body refusal (415) and the `maxBytes` ceiling (413) to every content type; a non-JSON body still reads as `{}`.
