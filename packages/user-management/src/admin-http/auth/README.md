# admin-http/auth — owner-auth route specs

Subpath entry `@jini-ai/user-management/admin-http/auth` (node). Framework-free `defineJsonRoute`
specs for the owner sign-in surface: `passwordLoginRoute`, `mfaLoginRoute`, `logoutRoute`,
`bootSessionRoute`, `localBootSessionRoute`, `currentUserRoute` (`GET /auth/me`) and
`createPasswordStatusRoute()` (`GET /auth/me/password-status`). The routes name no cookie, header,
limiter or framework type; every piece of response policy is host code reached through the
per-request `AuthRequest` context.

## Wiring

**Needs injected (all by the host, nothing is defaulted or registered on import):**
- **The per-route auth context.** The host's `authenticate` port binds a context on every request,
  built from the framework request it reaches through `res.req`. Each route asks only for its narrowed
  view of `AuthRequest` (`auth-request.ts`): `SignInAuth` (password + MFA login), `LogoutAuth`,
  `BootSessionAuth`, `LocalBootSessionAuth`, `CurrentPrincipalAuth` (`/auth/me*`). The host's full
  `AuthRequest` satisfies every view, so one binding can serve the whole registration; a missing
  context is a wiring fault (`requireAuthRequest` throws).
- **Cookies and session revocation** — `cookies.replaceSession` / `cookies.clearSessions` (the host
  owns the cookie name and flags and returns the `Set-Cookie` values it wrote), `revokeSessions`
  (runs before a replacement cookie is set), `noStore`, `retryAfter`, `sessionOptions` (ip,
  user-agent, TTL) and the fire-and-forget `signedIn` signal.
- **The login limiter** — `rateLimit.check()` and `clientKey`: the registration's ONE limiter, shared
  with the host's recovery, MFA and passkey routes.
- **Boot redemption** — `loopback`, `localOwnerSignIn` (enabled / capability / request policy) and
  `redeemBootSession`, which the host implements over its process-wide boot-session token store
  (`identity/boot-session-token`) and, for local sign-in, a request-scoped store.
- **Route deps** — `PasswordLoginRouteDeps` (`login` / `beginOwnerLogin` pre-bound to the host's
  identity deps, `mfaStore` when owner MFA is configured), `MfaLoginRouteDeps.completeOwnerLogin`
  (the host's MFA service), `CurrentUserRouteDeps` (`effectivePermissions`,
  `callerMayManageUserTrash`, `canPublishToLive`), `PasswordStatusRouteDeps` (`verifyPassword` and
  `defaultOwnerPassword`, the host's seeded owner password — product default, K3).
- **The error port.** Every refusal is thrown as `RouteRefusalError` for the host's `onError` to
  write verbatim; a deliberate sign-in failure is an `OwnerAuthFailure` the host answers with its
  redacted auth envelope. Anything else (a repository fault) takes the host's ordinary error path:
  the host's `onError` forwards it to its framework's error chain (OD-2, e.g. `res.req.next(error)`).

**Provides:** the seven route specs above, the `AuthRequest` contract and its per-route views,
`BootRedemption`, and `OwnerAuthFailure`.

**Must never import:** a host app module, a server-framework type (express `Request`/`Response`),
a host log formatter, or UI packages.
