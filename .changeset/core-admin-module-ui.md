---
"@jini-ai/core": minor
"@jini-ai/admin": minor
---

The module UI contract moves to `@jini-ai/core/contracts/admin-module` (types only, no UI library named): `TabViewProps`, `ModulePageProps<Tab>`, `ModuleViews`, `ModuleBinding`, `UseAdminController` and `AdminModuleUi`. A module package states this contract and receives the implementation from its host; it never imports one (owner answer 2026-11-17, J4).

`@jini-ai/admin/core/react` now also exports `reactModuleUi` (admin's React implementation of `AdminModuleUi`) and the `LazyTabView` type, and no longer exports `ModulePageProps` / `TabViewProps` (import them from `@jini-ai/core/contracts/admin-module`). The re-export entries `@jini-ai/admin/react/bind-react` and `@jini-ai/admin/react/use-controller` are removed; import `bindReact` / `useController` from `@jini-ai/admin/core/react`.
