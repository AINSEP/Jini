# settings/site

Site-level settings helpers a host composes into its own settings feature: admin-interface keys,
chart provider, form delivery bindings and destinations, mail sender, site time zone, and the
read-only admin-language discovery tool (`ui-locales-tool.ts`).

## Wiring

**Needs injected** (`ui-locales-tool.ts`): `UiLocalesToolDeps` — the host's `authorize: AuthorizeFn`,
`workspaceId`, and `locales: readonly UiLocaleOption[]` (the languages its admin selector offers;
product copy the engine never ships). Host tool metadata (search vocabulary, approval policy) is
not bound by the package.

**Provides**: `buildUiLocalesRegistrations(deps)` (one `settings_list_ui_locales` registration),
`uiLocalesAgentToolCatalog`, `uiLocalesDerivedRisk`.

```ts
import { withToolMetadata, type ToolContributor } from "@jini-ai/core";
import { buildUiLocalesRegistrations, uiLocalesDerivedRisk, type UiLocalesToolDeps } from "@jini-ai/cms/settings/site/ui-locales-tool";

export const contributeUiLocalesTools = (): ToolContributor<Omit<UiLocalesToolDeps, "locales">, unknown> => ({
  domain: "settings-ui-locales",
  build: (deps) => withToolMetadata({ registrations: buildUiLocalesRegistrations({ ...deps, locales: HOST_ADMIN_LOCALES }), metadata: hostToolMetadata }),
  risk: uiLocalesDerivedRisk,
});
```

**Must never import**: a host's locale list, tool-metadata contracts, settings storage or any host
module; other `@jini-ai/*` packages only through their public entries (`@jini-ai/core`).
