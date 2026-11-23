# deployment

Host-side helpers for a Deployment panel.

- `Deployment.hooks.ts` — `navigateDeploymentTab` keeps the panel's selected tab in its deep link
  (`/deployment?tab=<id>`), replacing the history entry rather than stacking one per tab click.

## Wiring

The host passes `navigate` (normally the admin router's `navigate` from
`@jini-ai/admin/shell/lib/router`) with each call: `navigateDeploymentTab({ nextTabId, navigate })`.
Injected rather than imported so this feature folder does not reach across into the shell domain.
