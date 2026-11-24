---
"@jini-ai/desktop-host": patch
---

Add `@jini-ai/desktop-host/electron/session-bootstrap`: `exchangeSessionJson` / `exchangeSessionRequest` (a cookie exchange bound to an Electron session's own jar via `useSessionCookies`, drained and resolving a `SessionOutcome` on `end`, never rejecting for HTTP or transport failures), `probeSession` and `hasSessionCookie` (server-asked session validity with a cookie-by-name cheap negative), `persistentPartitionName` (hashed per-key `persist:` partition), and `armExactUrlHeader` (exact-URL request header in one session). Endpoints, cookie, partition and header names, URL guards and copy are injected by the host.
