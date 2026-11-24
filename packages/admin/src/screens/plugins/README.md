# screens/plugins

The site (CMS/runtime) Plugins screen's wire types, API client, ports and small hooks. Agent
Plugins live separately in `../../agent-plugins/`; nothing here duplicates that module.

## Wiring

What the host injects for each module:

- `api/plugins-api.ts` — `createPluginsApi({ request, workspaceId })`: the host's authenticated
  admin `request` and the workspace id every `/workspaces/<id>/plugins` path is scoped under. The
  host builds one singleton (`pluginsApi`) and every caller reads it.
- `api/plugins-api.types.ts` — wire types only; nothing injected.
- `hooks/plugins-port.hooks.ts`, `hooks/plugin-install-port.hooks.ts`,
  `hooks/agent-plugin-memory-port.hooks.ts` — port interfaces; the host implements them over its
  own API clients and passes the implementation to the hooks that consume them.
- `hooks/use-plugin-row-focus.hooks.ts` — nothing injected; the host row calls it with `focused`
  and attaches the returned ref to its `<li>` (the hook focuses the row's `.plugin-row-summary`).
- `PluginProviderSettingField.hooks.ts` — nothing injected; the host field passes the
  `field`, `value` and `onChange` it renders.
- `selected-skills.ts` — pure composer-skill selection rules; nothing injected.
