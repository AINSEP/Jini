# API connections (`@jini-ai/integrations/api-connections`)

## Purpose

A provider plugin declares an OAuth connection ("sign in to this service"); this module runs the
generic lifecycle for it: sign-in, status, reconnect, staged account switch, disconnect with
remote revocation, and short-lived access tokens for the plugin's own API calls. It names no
provider. Everything provider-specific (endpoints, extra authorization parameters, scope sets,
reading the signed-in account, revocation) comes from the plugin's descriptor and hooks.

The OAuth mechanics are reused from `@jini-ai/oauth`, not reimplemented:
`beginAuthorizationCode` / `completeAuthorizationCode` (PKCE S256, redirect allowlist, callback
error mapping, code exchange), `createTokenRefresher` and `refreshAccessToken`.

## Public API

| Export | What it is |
|---|---|
| `parseApiConnectionDescriptor({ value })` | Validates and freezes a plugin's untrusted declaration (ids, endpoints, bounded extra params, allowlisted start params and callback fields; OAuth parameter names are reserved). |
| `createApiConnectionService(deps)` | One service per declared connection. Returns `start`, `complete`, `confirmSwitchAccount`, `cancelSwitchAccount`, `disconnect`, `getStatus`, `getAccessToken`, `connectionRefFor`, `readGeneration`. |
| `deriveApiConnectionKey({ workspaceId, pluginId, connectionId })` | The opaque key. It is also the public `connectionRef` and the token-store key. |
| `createApiConnectionGenerationReader({ records })` | `readGeneration({ key })` for a generation-fenced token store (main and staged keys). |
| `ApiConnectionError` | Every refusal; branch on `code`, show `message` (it says what to do next and never carries tokens). |

Ports (`ports.ts`), all injected:

- `ApiConnectionTokenStore = OAuthTokenStore & { install({ key, tokens, generation }), loadForRevocation({ key }), delete({ key }) }` —
  secret storage (a vault). `persist` is the refresher's write and may require the store's refresh
  lease; `install` is the sign-in / switch write: no lease, refused once the live generation differs
  from `generation` or a newer generation's tokens are stored. `load` returns null for tokens of an
  older generation (that is what disables a credential on disconnect); `loadForRevocation` returns
  them anyway, owner-checked, because only that disabled credential can still revoke the grant. The
  engine hands its result to the revoke hook and nothing else; never wire it into a refresher, tool
  or host read path. The bundled vault token store (`createVaultOAuthTokenStore`) implements all of
  them, so a host needs no wrapper of its own.
- `ApiConnectionRecordStore` — non-secret metadata: `read`, `compareAndSet({ key, expectedRevision, record })`,
  `putAttempt`, `takeAttempt` (atomic consume-once). Attempts hold a short-lived PKCE verifier:
  keep them out of logs and exports.
- `ApiConnectionHooks` (the plugin) — `resolveScopes({ scopeSetIds })`, `readAccount({ accessToken })`,
  `revoke({ token })` (throw unless the provider confirmed; a retry may resend a token the provider
  already revoked, so treat "token already invalid" as success).

## Client kind vs auth method

`deps.clientKind` says how the app is registered; `deps.client.authMethod` says how it
authenticates at the token endpoint. They are separate because some providers give installed
apps a client secret that is not confidential:

| `clientKind` | Meaning | Rules it selects |
|---|---|---|
| `public` | Installed app: PKCE, loopback callback, re-consent replaces the whole token set | `authorizationParams.public`; a same-account exchange without a refresh token replaces the set |
| `confidential` | Hosted server that keeps its secret | `authorizationParams.confidential`; a same-account exchange without a refresh token keeps the stored one |

A `public` client may use `client_secret_post` / `client_secret_basic`; its secret is still a
secret: it stays in the host's server-side config, is sent only to the token endpoint, and never
appears in attempts, records, stored tokens, status, results or error messages. A `confidential`
client with `authMethod: 'none'` is refused at construction (`configuration-invalid`).

## How it behaves

- **Attempts** are stored, expire after 10 minutes, are consumed before any check (a probe burns
  the state it guessed) and are bound to workspace, actor, plugin connection, requested scopes,
  the exact callback URL and the credential generation. Every mismatch is the same `invalid-attempt`.
- **Grant check**: every requested scope must be granted, otherwise nothing is stored
  (`scope-not-granted`). A token response without `scope` means "as requested" (RFC 6749 §5.1).
- **Credential install** is fenced: the record first moves to a new generation in
  `reconnect-required`, then tokens are written, then the record becomes `connected`. A crash in
  between leaves "reconnect required", never a record that disagrees with its token.
- **Reconnect** (`intent: 'connect'`) keeps the same `connectionRef` and must sign in as the same
  account (`account-mismatch` otherwise). A same-account exchange that omits a refresh token keeps
  the stored one; every other part of the set is replaced. A `public` (installed) client that would
  end up with no refresh token (first connect, switch, or nothing valid stored) is refused with
  `offline-access-required`: it could not renew access once the access token expires.
- **Switch account** (`intent: 'switch-account'`) stages the new tokens and identity; nothing
  changes until the same actor calls `confirmSwitchAccount`. Bindings that froze an account pass
  `getAccessToken({ connectionRef }, { expectedAccountId })` and get `account-changed` instead of
  silently using the new account. While a switch is staged every new sign-in is refused
  (`switch-in-progress`), so a consented staged credential is never overwritten or orphaned
  unrevoked; the record claims the staged slot before its tokens are written. Signing in as the
  account already connected is refused (`account-unchanged`, "use reconnect"): the staged copy
  would share the live grant, so cancelling it would revoke the live credential.
- **Confirmed switch** returns `previousAccountRevocation: 'not-attempted'`: the previous account's
  grant is left at the provider (revoking it could cut off the same account connected elsewhere
  through the same client) and its local tokens are replaced. Hosts say so and link the provider's
  account-access page. A same-account reconnect never revokes either: the new tokens share the grant.
- **Cancel switch** revokes the staged credential; when the provider does not confirm, the switch
  stays staged (`remoteRevocation: 'pending'`) and cancelling again retries.
- **Disconnect** stops use first (new generation, `revocation-pending`: no token is served or
  refreshed from then on), then revokes the live credential and any staged one through the hook,
  deleting each only after the hook returned. All confirmed (or nothing stored) → `disconnected`.
  Any failure → stays `revocation-pending` with the disabled credential kept, `remoteRevocation:
  'pending'` (show "Disconnected locally; revocation pending" and the provider's account-access
  page); calling `disconnect` again retries. `not-needed` means no credential was stored. A sign-in
  is refused while revocation is pending. A stored credential this host can no longer read (it was
  sealed for another OAuth client id, or is malformed) is deleted locally and reported `pending`
  with status `disconnected`: nothing is left to retry with, so the person removes the access on
  the provider's account page, and a new sign-in is allowed.
- **Access tokens** are served only for `connected` records; a rejected refresh moves the record
  to `reconnect-required`.

## How a provider plugin uses it

```ts
const descriptor = parseApiConnectionDescriptor({ value: plugin.manifest.connection });
const service = createApiConnectionService({
  descriptor, client, clientKind: runtime === 'desktop' ? 'public' : 'confidential', appOptions: { clientDisplayName, softwareId, redirectUris },
  hooks: plugin.connectionHooks, records, tokens, fetchFn, guard, clock, randomBytesFn, sleep,
});
// `state` is host-only (e.g. arming a loopback receiver); `attemptId` is what plugin code may hold.
const { authorizationUrl, connectionRef, state, attemptId } = await service.start(
  { workspaceId, actorId, intent: 'connect', scopeSetIds: enabledModules, redirectUri });
// ...the browser returns to redirectUri...
const done = await service.complete({ workspaceId, actorId, redirectUri, callbackParams }); // done.attemptId === attemptId
const accessToken = await service.getAccessToken({ connectionRef, workspaceId });
```

Descriptor extension points: `authorizationParams.public` / `.confidential` (fixed extra
parameters per client kind, e.g. a forced consent prompt for installed apps or incremental-grant
flags for hosted ones), `startParams` (names a caller may set for one sign-in, e.g. a selection
mode) and `callbackFields` (extra fields a provider returns after consent; returned in
`complete(...).callbackFields` only after the exchange succeeded, and still to be verified by the
plugin through the provider's API before being trusted).

## Host responsibilities

Authorize the caller for a workspace before any call and pass that `workspaceId` with every
`connectionRef` (`getAccessToken`, `getStatus`, `disconnect`, `confirmSwitchAccount`,
`cancelSwitchAccount`); the service refuses a ref whose record belongs to another workspace,
plugin or connection with the same `connection-not-found`. Seal tokens at rest, make
`compareAndSet` and `takeAttempt` atomic, and pass the exact callback URL a request arrived on.
