---
"@jini-ai/cms": minor
---

Breaking: `@jini-ai/cms` no longer exports `./consent`, `./consent/html`, `./consent/node` or `./consent/express`. The legacy consent HTML rewriting they carried is retired; consent now lives in `@jini-ai/cookie-consent` (`./render`, `./server`, `./node`, `./client`, `./plugins`), where pages declare their scripts instead of having HTML classified and rewritten.
