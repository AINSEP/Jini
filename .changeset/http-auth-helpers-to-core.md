---
"@jini-ai/core": patch
"@jini-ai/http-kit": patch
"@jini-ai/daemon": patch
---

`bearerTokenFromHeader` moves to `@jini-ai/core/contracts/server` and `isLoopbackPeerAddress` to `@jini-ai/core/net` (strict dotted-quad IPv4 test, parity-checked against `net.isIP`); `@jini-ai/http-kit` no longer exports either. The daemon's tool-execution caller gate and remote-run-event token gate take an optional `timingSafeEqual` (default `node:crypto`) and compare through core's `timingSafeTokenMatch`; `@jini-ai/core/contracts/server/testing` adds `fakeTimingSafeEqual`. `RouteRegistration` is declared by the daemon's route manifest instead of imported from http-kit.
