# seo/site

Host-facing SEO pieces moved from a site host: the page-head contributor that binds SEO tags into
the render pipeline (`page-head-contributor.ts`), the SEO learning card the site guide lists
(`capability-card.ts`), the `site.seo.*` settings mapping (`settings.ts`) and the agent-tool
binding (`tool-registrations.ts`). SEO resolution itself stays in `../seo.ts`.

## Wiring

- **Needs injected:** `createSeoPageHeadHook` takes the host's `GetEntryMetaDeps` (see `../seo.ts`).
  `capabilityCard` is static data and needs nothing.
  `settings.ts` takes every settings-ledger collaborator on its existing deps
  (`SeoSettingsLedgerBindings`, all required): `ensureSettingDefinitions` and `getEffective`
  (`@jini-ai/core/settings`), the chokepoint `set` (the package's, or the host's policy-wrapped one)
  and `createPrincipalLookup` (the host's active-principal policy). `tool-registrations.ts` takes the
  host's `toolMetadata`, `hostReads` vocabulary and `settingsLedger` through `SeoToolHostPolicy`.
- **Provides:** `./seo/site/settings` (`ensureSeoSettingDefinitions`, `getSeoSettings`,
  `setSeoSettings`, `isDefaultRobotsNoindexExplicitlySet`), `./seo/site/tool-registrations`
  (`contributeSeoTools`, `buildSeoRegistrations`, `SeoToolDeps`),
  `./seo/site/page-head-contributor` (`createSeoPageHeadHook`) and
  `./seo/site/capability-card` (`capabilityCard`, a `GuideTopic` from
  `@jini-ai/core/contracts/site/agentic-core`).

```ts
import { capabilityCard as seo } from "@jini-ai/cms/seo/site/capability-card";

import type { GuideTopic } from "@jini-ai/core/contracts/site/agentic-core";

// The host lists its built-in capability cards; the site guide reads them beside plugin topics.
export const BUILT_IN_CAPABILITY_CARDS: readonly GuideTopic[] = [content, forms, seo, deploy];

// The host binds its settings ledger once and spreads it into each settings call's deps.
export const seoSettingsHostBindings: SeoSettingsLedgerBindings = {
  ensureSettingDefinitions, getEffective, set: hostSet, createPrincipalLookup: hostPrincipalLookup,
};
await ensureSeoSettingDefinitions({ ...seoSettingsHostBindings, settingsRepo, clock, ids, principals }, { workspaceId, systemPrincipalId });
contributions.register({ contribution: contributeSeoTools({ toolMetadata, hostReads, settingsLedger: seoSettingsHostBindings }) });
```

- **Must never import:** a host module, `@jini-ai/agentic` (the card's type comes from core), a
  logger or an HTTP framework. Package boundaries: `docs/decisions/DR-005-portable-package-boundaries.md`.
