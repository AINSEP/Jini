---
"@jini-ai/core": minor
---

`decodeListCursor` and `pageFromArray` take a caller-given position `shape` instead of a size learned from a row, so an empty list and a string-for-number cursor are refused.
