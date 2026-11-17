---
"@jini-ai/core": patch
---

`createRouteTable` and `createInMemoryServer` take an opt-in `lenientPaths` option: fixed segments ignore letter case, one trailing slash is accepted, and a malformed `:name` segment is reported as the new `malformed-path` match (400 in the in-memory server) instead of "no match", the way Express 4 matches. The default stays exact. `jsonResponse` now states `Content-Length` (bytes), as Express's `res.json` did.
