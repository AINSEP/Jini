---
"@jini-ai/core": patch
---

`jsonResponse` (and `jsonRoute`'s `successStatus`) builds a bodyless response for 204, 205 and 304 instead of throwing.
