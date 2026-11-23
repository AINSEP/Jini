---
"@jini-ai/admin": minor
---

SEC-1 (P9-SEC plan v2): `security()` from `@jini-ai/admin/security/react` now takes the media
module's shape, `security({ ui }, { t?, rootKeyScopeNotice?, rootKeyTab?, tabIcons? })`, and binds
through the injected `ui.bindReact` instead of importing admin's React binding. Breaking: callers
pass `{ ui: reactModuleUi }` (or their host's module UI) where they passed `{}`.

- The page renders the kit `TabBar` with stable agent handles (`security-tab-access-tokens`,
  `security-tab-site-key`, container `security-tab-bar`), translated handle labels and optional
  host-supplied `tabIcons`, plus a kicker and description under the heading.
- `t` (and the Provider's live `t` prop) translates every page label; a locale change relabels in
  place without remounting a tab.
- `rootKeyTab: { generate?, defaultEnvVarName?, previewRequired? }` merges into the `root-key` tab's
  params beside the existing `scopeNotice`. Stock params stay empty.
- New exports: `englishSecurity`, `SecurityTranslator` (`./security`); `SecurityTranslator`,
  `SecurityRootKeyTabOptions`, `SecurityModuleOptions`, `SecurityTabIcons`,
  `useSecurityTranslation` (`./security/react`).
