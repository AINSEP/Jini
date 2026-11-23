# screens/plugins

Leaves of the host admin's Plugins and Agent Plugins screens that carry no host transport:
the tab "Soon" tags, the agent-plugin glyphs, the plugin-memory copy, the linked-padlock tip
controller and the admin-surface port's types. The screens themselves (rows, panels, dialogs,
data hooks) still live in the host.

## Wiring

- `add-plugin-tab-soon.ts` — `addPluginTabSoonTag` / `marketplaceTabSoonTag` take
  `translateAdminNavLabel` (an `AdminNavLabelTranslator`): the package ships `ADMIN_NAV_DICT`, the
  host binds the callable once (in the reference host: `apps/admin/src/lib/admin-nav-i18n.ts`) and
  passes it from its Plugins and Agent Plugins pages.
- `agent-plugins-visuals.tsx`, `hooks/use-linked-lock-tip.hooks.ts` — draw through the injected
  admin kit (`Icon`, `useInfoTip` from `react/kit.tsx`); the host mounts `<AdminKitProvider>` at its
  root. The row chevron carries `jini-agent-plugin-chevron-glyph`; the host styles its rotation.
- `plugins-memory-i18n.ts` — falls back to `ADMIN_COMMON_I18N` (`core/i18n-common.ts`); nothing injected.
- `hooks/agent-plugin-surfaces-port.hooks.ts` — types only (`AgentPluginSurfacesPort`); the host
  implements the port against its own admin-surface routes.
