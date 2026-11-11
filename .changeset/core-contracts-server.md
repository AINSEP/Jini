---
"@jini-ai/core": minor
---

Adds the `@jini-ai/core/contracts/server` subpath: the types-only `Server` route contract on web `Request`/`Response`. It exports `ServerMethod` (including `HEAD` and `OPTIONS`), `ServerHandler` (handlers get `{ request, params, client? }`, where `client.address` is the socket peer), `ServerRoute` (one route as data, so a host can mount a package's route list) and `Server`. It also fixes route precedence: a literal segment beats a `:name` segment at the first position where they differ, and registration order never decides. Not exported from the root barrel.
