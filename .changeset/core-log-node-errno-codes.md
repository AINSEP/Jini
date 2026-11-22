---
"@jini-ai/core": patch
---

`describeErrorForLog` and `describeErrorParts` now print every Node system error code (each libuv errno name, such as `EIO`, `EAGAIN`, `ENOTSUP`) as an approved code. An unlisted code is still left out.
