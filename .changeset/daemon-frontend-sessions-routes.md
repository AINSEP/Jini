---
"@jini-ai/daemon": patch
"@jini-ai/server": patch
---

The frontend-session routes are returned as data: `frontendSessionRoutes({ deps, host })` replaces `registerFrontendSessionRoutes`, and `FrontendControl.routes({ host })` replaces `httpExtension` (both removed, no alias; `handleFrontendSessionStream` and `FrontendHttpExtension` go with them). `createFrontendControl` and the route group's deps take a required `setTimer` (the preset exports `nodeSessionTimer`). The owner and capacity hooks take a `FrontendHookInput` (`request` headers and the host's `locals`) instead of Express's `req`/`res`; the daemon never gives them the socket peer. `onInternalError` on the session deps is gone: failures go through the host's reporter. Answers change as follows: plain refusals carry a `Content-Length` and no `ETag`; an owner hook that throws answers 500 with a request ID on the stream and 403 on the responses route (which now also reports the error). D-FS1: a `capability[...]` query key is refused with the stream's error event (`capability[]=a` used to be read as a list), and a `capability` after the thousandth query parameter is now counted.
