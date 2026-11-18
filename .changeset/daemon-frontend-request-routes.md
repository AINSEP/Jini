---
"@jini-ai/daemon": patch
---

The page-request route is returned as data: `frontendRequestRoutes({ path, control, executor, resolveOwner, capabilityIds, host })` replaces `registerFrontendRequestRoute` (removed, no alias; its `FrontendRequestRouteRequired` type is now `FrontendRequestRoutesRequired`). It answers on the NDJSON line stream with a 15 s keepalive from the host's scheduler. `resolveOwner` takes a `FrontendHookInput`. The three refusal bodies are unchanged byte for byte; an owner hook that throws still answers 403 and now also reports the error to the host's sink. New `tool-execution-stream.ts` (`writeToolExecution`, `wireError`) holds the tool-call-to-lines step on the line stream.
