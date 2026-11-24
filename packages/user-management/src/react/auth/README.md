# react/auth — sign-in, MFA, passkey and owner-recovery screens and clients

## Wiring

**Owner clients** (entries `./react/auth/{owner-mfa-api,owner-passkey-api,owner-recovery-api,local-owner-signin}`,
added 2026-11-23). Nothing is bound on import; the host builds each once in its own binding module:
- `createOwnerMfaPort({ requestOnce })`, `createOwnerPasskeyPorts({ requestOnce })` → `{ settings, signIn }`:
  `requestOnce` is the host's SINGLE-SEND request function (`OwnerRequestOnce`); a lost response must never replay a proof.
- `createOwnerRecoveryClient({ requestOnce, describeApiError, redactionOptions })` → `{ port, failure }`:
  the host's API-error describer and its product redaction options (K3: they stay in the host).
- `createLocalOwnerSignIn({ apiErrorClass, readInitialSession })` → `{ readInitialAdminSession }`: the host's
  API error class (only its 401 `UNAUTHENTICATED` starts a bootstrap) and `readInitialSession` from
  `@jini-ai/user-management/session-bootstrap` (injected; this browser entry does not reach that entry).
