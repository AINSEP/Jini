---
"@jini-ai/admin": minor
---

`AdminShell` takes its four hooks as props (`useSessionHook`, `useThemeHook`, `useRouteHook`, `useDrawerHook`, each defaulted to the real hook) and accepts a host-owned session (`useHostSession`, no port; the type allows exactly one session source). New optional slots: `sidebar` (host-composed sidebar receiving the visible nav, the exact `<Sidebar>` props and `setDrawerOpen`), `frame` (wraps the whole authenticated layout), `beforeMain`, `afterMain` and `assistantAside`; new `ids` prop for the nav and main DOM ids. The nav is memoized on panels, capabilities, permissions, route and `translateNav` (pass a stable function). Absent slots render the same markup as before, except the topbar toggle icon now has round line caps. The `jini-` class rename of the shell and `Sidebar` is not part of this change.
