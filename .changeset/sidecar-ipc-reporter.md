---
"@jini-ai/sidecar": minor
---

`createJsonIpcServer` can now report handler failures through a host's error reporter. Pass the new `errors` option (`{ reporter, observability?, methodOf?, refusalCode: 'HANDLER_ERROR' }`) and an optional `logger`. A failed request becomes one incident whose `ERR-` ID appears in the reply's words and `requestId`. A deliberate refusal keeps the `HANDLER_ERROR` code and adds its own code as `reason`, with no ID. `requestJsonIpc` rejections now carry `reason` beside `code`. Servers that do not pass `errors` behave exactly as before.
