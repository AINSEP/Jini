---
"@jini-ai/core": patch
---

`createSseStream` closes the stream and stops its keepalive when the request signal is already aborted at creation.
