# site-inspection

Read-only aggregation services that answer "what does this site look like" and "what can this site
do" for an agent tool or an admin route, one authorized section at a time.

- `site-profile` — `buildSiteProfile({ deps, input }, options)`: pages, theme, plugins, settings and
  content types, each authorized against its own domain permission.
- `site-capabilities` — `buildSiteCapabilities({ deps, input }, options)`: tool catalog, admin
  screens and content types.
- `section-collector` — the shared authorize-then-collect step (`authorizeAndCollectSection`,
  `resolveRequestedSections`, `SectionUnavailableError`).

## Wiring

Architecture: [DR-005 portable package boundaries](../../../../docs/decisions/DR-005-portable-package-boundaries.md).

**Injected by the host** (all on the existing `deps` object; nothing is imported from the host):

- `SiteProfileDeps` — the narrow read ports (`listPosts`, `listThemes`, `readActiveThemeId`,
  `listPlugins`, `listPluginActivations`, `readSetting`, `listContentTypes`), `authorize`, `clock`,
  plus the host's theme identity (`noThemeId`, `themeIdCandidates`) and `reportSectionFailure`.
- `SiteCapabilitiesDeps` — `listCatalogTools` (optional), `listAdminScreens`, `listContentTypes`,
  `authorize`, `clock`, `reportSectionFailure`.
- `InspectionFailureReporter` — receives `{ label, section, error }` with the FULL error. The host
  owns the log format and sink; responses only ever carry a fixed reason or the error class name.

**Provides**: the two aggregate DTOs (`SiteProfile`, `SiteCapabilities`), their closed section
vocabularies and permission maps, and the page/summary caps.

```ts
import { buildSiteProfile } from "@jini-ai/cms/site-inspection/site-profile";

const profile = await buildSiteProfile({
  deps: {
    ...readPorts, workspaceId, authorize, clock,
    noThemeId: HOST_NO_THEME_ID,
    themeIdCandidates: hostThemeIdCandidates,
    reportSectionFailure: ({ label, section, error }) => hostLog.error(`[${label}] ${section}`, error),
  },
  input: { principalId },
}, { sections: ["theme", "settings"] });
```

**Must never import**: host code, any credential/secret store, a server framework, or a console
logger. Secrets stay unrepresentable because no dep field can carry one — adding a dependency is the
only way to widen what a profile can reach.
