# member-login

Member-only OIDC sign-in: begin/complete the authorization-code redirect, validate the ID token,
and seal/open the emailed-code continuation. Entry: `@jini-ai/user-management/member-login/oidc-login`
(Node; it uses `node:crypto`). Why effects arrive as ports: [DR-005](../../../../docs/decisions/DR-005-portable-package-boundaries.md).

## Wiring

**Needs injected** (all fields of `OidcLoginDeps`):

- ports: `clock` (`Clock`), `randomBytesFn` (`OAuthRandomBytes`), `httpPorts` (`OAuthHttpPorts`), `sealer` (`SecretSealerPort`),
  `keyring` (`KeyringPort`), `origin` (`OriginRegistryPort`), `resolveProvider`, `resolveClient`
- client identity: `appIdentity` (`clientDisplayName`, `softwareId`; no library default)
- OAuth operations: `beginAuthorizationCode`, `completeAuthorizationCode`, `createSealedAuthorizationState`
  (`OAuthFlowOperations`), `createSealerStateCodec` (`CreateSealerStateCodec`), `validateOidcIdToken` (`ValidateOidcIdToken`)
- AAD formatter: `formatAad` (`FormatAad`)

**Provides**: `beginOidcLogin`, `completeOidcLogin`, `memberLoginCallbackUrl`, `sealLoginEmailContinuation`,
`openLoginEmailContinuation`, and the `OidcLoginDeps`, `LoginContext`, `CompletedOidcLogin` types.

```ts
import { beginAuthorizationCode, completeAuthorizationCode, createSealedAuthorizationState,
  createSealerStateCodec, validateOidcIdToken } from "@jini-ai/oauth";
import { formatAad } from "@jini-ai/platform/secrets";
import { beginOidcLogin, type OidcLoginDeps } from "@jini-ai/user-management/member-login/oidc-login";

const deps: OidcLoginDeps = { clock, randomBytesFn, httpPorts, sealer, keyring, origin, resolveProvider, resolveClient,
  appIdentity: { clientDisplayName: "Example members", softwareId: "example-member-login" },
  beginAuthorizationCode, completeAuthorizationCode, createSealedAuthorizationState, createSealerStateCodec, validateOidcIdToken, formatAad };
const { authorizationUrl, browserBinding } = await beginOidcLogin({ deps, input: { workspaceId, providerId } });
```

### Link service

Entry: `@jini-ai/user-management/member-login/link-service` (Node; it reaches the member session minter).
`resolveFederatedIdentity` resolves/links/activates a verified identity and mints the member session in
one storage transaction; `requestLoginEmailProof` asks the existing challenge owner for an inbox proof.

**Needs injected** (`MemberLoginLinkDeps`, beyond `MembersWriteServiceDeps` incl. `mailTransport`):

- `identities` (`MemberExternalIdentityRepoPort`)
- `transaction`, `lockKey` — from the SAME `StorageKernel` (`@jini-ai/core/contracts/storage`) as every member adapter
- `reportFailure({ operation, error })` (`MemberLoginFailureReporter`, required) — the host's private failure log.
  The caller only ever sees the fixed `LOGIN_UNAVAILABLE` code (no `cause`), so this is where the original
  mail/origin failure is recorded. It must not throw.

```ts
import { requestLoginEmailProof, type MemberLoginLinkDeps } from "@jini-ai/user-management/member-login/link-service";

const links: MemberLoginLinkDeps = { ...membersWriteDeps, identities, transaction: body => kernel.transaction(body),
  lockKey: key => kernel.lockKey(key), reportFailure: ({ operation, error }) => hostLog.privateFailure({ operation, error }) };
await requestLoginEmailProof({ deps: links, input: { workspaceId, email } });
```

**Must never import**: anything but `@jini-ai/core` and this package. The OAuth runtime
(`@jini-ai/oauth`), `@jini-ai/platform` and `@jini-ai/integrations` reach it only through the host's deps.
