---
"@jini-ai/daemon": patch
---

The message-claim route is returned as data: `messageRelayRoutes(deps)` replaces `registerMessageRelayRoutes` and `createMessageRelayClaimHandler` (both removed, no alias). The credential and run checks still run before the body is read, and the answers are byte for byte the same. The body is read at most 8 KiB (the only valid body is about 40 bytes; a host that parses first with a smaller limit keeps its limit). An executor or resolver failure is thrown, not answered here, so it reaches the host's own error path as before.
