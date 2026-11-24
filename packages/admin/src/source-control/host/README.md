# source-control/host

Host-screen helpers for a Source control panel, kept apart from the framework-free
`source-control` module (`../index.ts`) because they drive the browser router.

- `SourceControl.hooks.ts` — `navigateSourceControlTab` keeps the panel's selected tab in its deep
  link (`/source-control?tab=<id>`), replacing the history entry.

## Wiring

The host passes `navigate` (normally the admin router's `navigate` from
`@jini-ai/admin/shell/lib/router`) with each call: `navigateSourceControlTab({ nextTabId, navigate })`.
