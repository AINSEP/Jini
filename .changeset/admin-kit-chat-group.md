---
"@jini-ai/admin": minor
---

The admin kit (`@jini-ai/admin/react/kit`) gains a required `chat` group (`AdminKitChat`): the chat library's own translator (`useT`, read through the new `useChatT` facade and kept distinct from the UI translator) and the three run-poster factories `createMidRunMessagePoster`, `createTypedAnswerPoster` and `createA2uiActionPoster` (read through `useAdminKitChatPosters`). Shapes are restated structurally (`KitDeliverTypedAnswer`, `KitDeliverMidRunMessage`, `KitA2uiActionPosterInput`, …) so admin imports no chat package; the A2UI input keeps `path`, `fetch` and `reportFailure` required. Hosts add `chat` to their `satisfies AdminKit` assignment; `fakeAdminKit()` supplies posters that never reach a server.

`TabBarTab` gains `disabled`, `dot` and `dotLabel`, matching the host tab strip.
