---
'@jini-ai/daemon': patch
---

`@jini-ai/daemon/http` exports the `DaemonRouteHost` type: the one object a host builds per listener and hands to every daemon route group (same-origin policy and incident sink, the internal-error reporter, a timer port, the constant-time byte compare, and the largest JSON body a route may read). No route group takes it yet; this lands the contract a host can already build.
