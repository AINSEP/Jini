# screens/authentication

The admin Authentication page: an honest, disabled preview of the credentials each provider will
need once a provider-authentication backend exists. No value is accepted, kept or sent; the
provider fieldsets are `disabled` and there is no Save/Enable action (see the `@file` comment in
`Authentication.tsx` for why that is a security boundary).

| file | what it is |
|---|---|
| `Authentication.tsx` | The page — markup only; Home tab plus one disabled tab per injected provider. |
| `Authentication.hooks.ts` | `createAuthenticationTranslator({ locale, productName })`: binds the copy to a locale and fills `{product}`. |
| `authentication-i18n.ts` | Page copy in every admin locale, falling back to `ADMIN_COMMON_I18N`; `providerBackendNote({ locale, provider, product })`. |
| `authentication-host-slots.ts` | Feature-owned shapes of every injected collaborator (types only). |
| `model/provider-schemas.ts` | The provider / credential-field metadata types. The catalog itself is host policy. |

Where copy used to hard-code a product name, the dictionary keeps a `{product}` slot in every
locale; the host's name fills it (K3).

Rendered classes are `jini-page`, `jini-page-header`, `jini-page-header-text`, `jini-page-kicker`,
`jini-page-title`, `jini-page-description`, `jini-settings-ui-section`,
`jini-settings-ui-section--page-flow`, `jini-settings-ui-inert-note`, `jini-settings-ui-inert-control`,
`jini-source-config-add-form`, `jini-source-config-field`, `jini-source-config-field-label`,
`jini-source-config-field-required`, plus the shared `jini-settings-section(-card)`,
`jini-byok-card-title`, `jini-field-hint` and `jini-tabbed-dialog--inline`; the host styles them.

## Wiring

- **Needs injected (Authentication props):** `useAdminThemeBoundaryHook` (attributes spread onto the
  shell wrapper), `useAdminLocaleHook`, `productName` (host copy, K3), `providers` (the host's
  provider catalog — host policy), `SecretInput` (the host's reveal-toggle input), `SettingsShell`
  (the host's inline settings-dialog shell, wrapped in that shell's own i18n provider and with its
  stylesheet loaded).
- **Must never import:** the host's locale/theme hooks, its secret input, `@jini-ai/ui`'s settings
  shell or stylesheet, product copy, or another Jini package's implementation.

```tsx
<Authentication useAdminThemeBoundaryHook={useHostThemeBoundary} useAdminLocaleHook={useHostLocale}
  productName={HOST_PRODUCT_NAME} providers={HOST_PROVIDER_CATALOG} SecretInput={HostSecretInput}
  SettingsShell={HostSettingsShell} />
```
