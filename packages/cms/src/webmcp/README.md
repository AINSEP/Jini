# `webmcp`

The published-site WebMCP switch (`settings.ts`) and the site-side confirmation copy for
browser-agent actions (`webmcp-i18n.ts`).

## Wiring

Architecture: [DR-005 portable package boundaries](../../../../docs/decisions/DR-005-portable-package-boundaries.md).

**Injected by the host** (on the existing args objects; nothing is imported from the host):

- `ensureSettingsUiTabDefinitions(required, optional)` — the host's settings bootstrap deps
  (`settingsRepo`, `clock`, `ids`, `principals`) and `systemPrincipalId`; the host's settings
  composition root calls it once at boot.
- `isPublishedWebMcpEnabled({ settingsRepo, getEffective }, { workspaceId })` — the host's
  settings repo and the `getEffective` reader from `@jini-ai/core/settings`; bound by the host's
  public-site middleware composition.

**Provides**: `PUBLISHED_WEBMCP_NAMESPACE`/`PUBLISHED_WEBMCP_KEY` and
`PUBLISHED_WEBMCP_CONFIRMATION` (the host's published-page script injector reads it).
