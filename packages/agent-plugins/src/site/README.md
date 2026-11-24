# `src/site`

Generic plugin-host pieces extracted from a site host. Everything product-specific is injected.

## Wiring

- `retired-plugin-tool-aliases.ts` (`./site/retired-plugin-tool-aliases`): the host injects `replacements`
  (its retired plugin id -> successor catalog) and `toToolId` (its plugin id -> tool id rule) on the
  existing `required` object, at the composition root that registers the agent-plugin tool family.
- `deploy-split-activation.ts` (`./site/deploy-split-activation`): the host injects `activations`
  (its lifecycle owner's activation calls) and runs it before bundled seeding.
- `admin-surfaces/` (`./site/admin-surfaces/*`): see that folder's README.
