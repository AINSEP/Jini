---
"@jini-ai/daemon": minor
---

`createFrontendGuestScope` no longer takes Express types. Its hooks take `FrontendHookInput` (the request's method and headers as a web `Request` has them, plus the host's per-request `locals`), the host answers "is this HTTPS" through a new required `isSecureRequest`, and `issue` returns `{ tabCredential, setCookie }`: the caller sets `Set-Cookie` and `Cache-Control: no-store` and sends `{ tabCredential }` only. The cookie text is the one Express's `res.cookie` wrote. Breaking for the one host that called it with `{ req, res }`.
