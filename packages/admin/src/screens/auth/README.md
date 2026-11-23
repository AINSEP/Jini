# screens/auth

The admin sign-in screen: the Login form, its controller hook, and the owner-recovery sign-in.
Every host collaborator (HTTP client, error class, secret input, error notice, passkey and
recovery clients, the base login / recovery-code controller hooks, the locale hook and the
product name) is injected; this folder imports none of them.

| file | what it is |
|---|---|
| `Login.tsx` | The Login form — markup only. Heading is the host's `productName` (K3). |
| `hooks/use-login.hooks.ts` | `useLogin(props, { port, errors, useJiniLogin })`: failure copy + secret redaction around the base login controller. |
| `hooks/login-port.hooks.ts` | `LoginPort`, what the login controller needs from the outside world. |
| `OwnerRecoverySignIn.tsx` | The "Lost your owner password?" recovery form — markup only. |
| `OwnerRecoverySignIn.hooks.ts` | `useOwnerRecoverySignIn({ recover, t, useRecoveryCodeSignIn, ownerRecoveryFailure })` with the screen's copy. |
| `auth-host-slots.ts` | Feature-owned shapes of every injected collaborator (types only). |
| `auth-i18n.ts` | Signed-out login copy, falling back to `ADMIN_COMMON_I18N`. |
| `Login.hooks.ts` | `createLoginTranslator({ locale })`, binds that copy to a locale. |

Rendered classes are `jini-login-screen`, `jini-login-card`, `jini-login-field`,
`jini-login-error`, `jini-login-notice`; the host styles them.

## Wiring

- **Needs injected (Login props):** `useLoginHook` (the host's wired `useLogin`), `useAdminLocaleHook`,
  `productName`, `SecretInput`, `ErrorNotice` (the host chooses its anonymous disclosure policy),
  `PasskeySignIn` (passkey client already bound), `OwnerRecoverySignIn` (bound slot taking `{ t }`),
  `loadCurrentUser` (the host's `/auth/me`).
- **Needs injected (`useLogin` deps):** `port: LoginPort`, `errors: LoginApiErrorPort` (the host's
  admin HTTP error class), `useJiniLogin` (the base login controller hook).
- **Needs injected (`OwnerRecoverySignIn` props):** `recover`, `useOwnerRecoverySignInHook`, `SecretInput`,
  `ErrorNotice`; the hook takes `useRecoveryCodeSignIn` and `ownerRecoveryFailure`.
- **Must never import:** the host's HTTP client, the host's locale/theme hooks, product copy
  (brand names stay in the host), or another Jini package's implementation.

```tsx
<Login onLogin={onLogin} useLoginHook={useWiredLogin} useAdminLocaleHook={useHostLocale}
  productName={HOST_PRODUCT_NAME} SecretInput={HostSecretInput} ErrorNotice={HostIdOnlyErrorNotice}
  PasskeySignIn={HostPasskeySignIn} OwnerRecoverySignIn={HostOwnerRecoverySignIn} loadCurrentUser={hostAuthApi.me} />
```
