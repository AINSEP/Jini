# screens/auth

The host-neutral pieces of the admin sign-in screen. The Login form itself, its live
transport and the owner recovery / passkey sign-in adapters still live in the host until the
admin HTTP `request` client lands here (see the extraction plan:
`ADS-memory/reports/jini-port/extraction-plan.md`).

| file | what it is |
|---|---|
| `api/auth-api.types.ts` | `AdminUser`, the signed-in identity every auth caller passes around. |
| `hooks/login-port.hooks.ts` | `LoginPort`, what the login controller needs from the outside world. |
| `auth-i18n.ts` | Signed-out login copy, falling back to `ADMIN_COMMON_I18N`. |
| `Login.hooks.ts` | `createLoginTranslator({ locale })`, binds that copy to a locale. |

## Wiring

- **Needs injected:** a `LoginPort` implementation (`login`, optional `completeMfa`) bound to the
  host's own admin HTTP client, and the current locale string (from the host's locale hook).
- **Provides:** the `AdminUser` and `LoginPort` types, the login dictionary translator `t`, and
  `createLoginTranslator`.
- **Must never import:** the host's HTTP client, the host's locale/theme hooks, product copy
  (brand names stay in the host), or another Jini package's implementation.

```ts
import type { LoginPort } from "@jini-ai/admin/screens/auth/hooks/login-port.hooks";
import { createLoginTranslator } from "@jini-ai/admin/screens/auth/Login.hooks";

const loginPort: LoginPort = {
  login: (credentials, _optional = {}) => hostAuthApi.login(credentials),
  completeMfa: (input, _optional = {}) => hostAuthApi.completeMfa(input),
};
const t = createLoginTranslator({ locale: useHostLocale() });
```
