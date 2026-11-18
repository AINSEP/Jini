---
"@jini-ai/core": patch
---

`lastEventCursor` reads no cursor when `afterCursor` is repeated in the query (it used to take the first value). Express gave a route an array for a repeated key and the daemon's stream routes refused it, so the daemon's answer for such a request does not change when the stream routes move onto this reader.
