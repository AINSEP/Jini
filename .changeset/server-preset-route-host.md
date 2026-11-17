---
'@jini-ai/server': patch
---

Every feature's build context now carries `routeHost`, the one object a daemon route group that returns its routes as data is given (same-origin policy and incident sink, the internal-error reporter, timers, the constant-time byte compare, the largest JSON body a route may read). `composeJiniKernel` builds it once per composition. New optional config `jsonBodyParserLimitBytes`: a caller that set `installJsonBodyParser: false` passes the limit of its own parser, so a route never refuses a body that parser accepted; left out, the limit of the parser the kernel installs (102,400 bytes) is used. No route group takes the host yet, so no answer changes.
