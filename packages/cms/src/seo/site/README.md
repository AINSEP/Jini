# seo/site

Host-facing SEO pieces moved from a site host: the page-head contributor that binds SEO tags into
the render pipeline (`page-head-contributor.ts`) and the SEO learning card the site guide lists
(`capability-card.ts`). SEO resolution itself stays in `../seo.ts`.

## Wiring

- **Needs injected:** `createSeoPageHeadHook` takes the host's `GetEntryMetaDeps` (see `../seo.ts`).
  `capabilityCard` is static data and needs nothing.
- **Provides:** `./seo/site/page-head-contributor` (`createSeoPageHeadHook`) and
  `./seo/site/capability-card` (`capabilityCard`, a `GuideTopic` from
  `@jini-ai/core/contracts/site/agentic-core`).

```ts
import { capabilityCard as seo } from "@jini-ai/cms/seo/site/capability-card";

import type { GuideTopic } from "@jini-ai/core/contracts/site/agentic-core";

// The host lists its built-in capability cards; the site guide reads them beside plugin topics.
export const BUILT_IN_CAPABILITY_CARDS: readonly GuideTopic[] = [content, forms, seo, deploy];
```

- **Must never import:** a host module, `@jini-ai/agentic` (the card's type comes from core), a
  logger or an HTTP framework. Package boundaries: `docs/decisions/DR-005-portable-package-boundaries.md`.
