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

**Must never import**: anything but `@jini-ai/core` and this package. The OAuth runtime
(`@jini-ai/oauth`), `@jini-ai/platform` and `@jini-ai/integrations` reach it only through the host's deps.
