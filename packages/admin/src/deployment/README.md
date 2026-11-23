# deployment

Host-side helpers for a Deployment panel.

- `Deployment.hooks.ts` — `navigateDeploymentTab` keeps the panel's selected tab in its deep link
  (`/deployment?tab=<id>`), replacing the history entry rather than stacking one per tab click.
- `deployment-i18n.tsx` — the panel's dictionary (Overview, Static Site, Full Site, Dockerfile and
  History tabs), `createDeploymentTranslator`, `dockerfileLineCountLabel` and the thirteen
  `{error}`-carrying message templates. The per-locale blocks live in `deployment-i18n/` (size
  ratchet): the main dictionary split per locale group, plus the index-aligned audit and
  candidate-gap rows and the credential-row strings.

## Wiring

The host passes `navigate` (normally the admin router's `navigate` from
`@jini-ai/admin/shell/lib/router`) with each call: `navigateDeploymentTab({ nextTabId, navigate })`.
Injected rather than imported so this feature folder does not reach across into the shell domain.

`createDeploymentTranslator({ hostDictionary })` takes the host's own per-locale entries — the strings
that name its product, its server or its owner-password env var — keyed by the exact English strings
its rules and screens look up. They are laid over this package's dictionary per locale (host wins a
collision), then `ADMIN_COMMON_I18N`, then the English key. Build the translator once at module level
in the host and pass the bound `t` to the screens and hooks; the `{error}` templates take `locale`
directly and need no host entries.
