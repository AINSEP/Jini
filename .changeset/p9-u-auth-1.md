---
"@jini-ai/user-management": minor
---

Users: new node entry `@jini-ai/user-management/admin-http/auth` with K1 `defineJsonRoute` specs for `POST /api/admin/v1/auth/login`, `/auth/mfa/login` and `/auth/logout`. Each takes small per-route deps; the host's `authenticate` port binds a per-request `AuthRequest` (cookies, cache header, the shared limiter, revocation, sign-in signal) and its `onError` writes the thrown `RouteRefusalError` flat bodies. Parsers are total; every refusal is thrown.
