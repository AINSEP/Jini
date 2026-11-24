# screens/plugins

The site (CMS/runtime) Plugins screen's wire types, API client, ports and small hooks. Agent
Plugins live separately in `../../agent-plugins/`; nothing here duplicates that module.

## Wiring

What the host injects for each module:

- `api/plugins-api.ts` — `createPluginsApi({ request, workspaceId })`: the host's authenticated
  admin `request` and the workspace id every `/workspaces/<id>/plugins` path is scoped under. The
  host builds one singleton (`pluginsApi`) and every caller reads it.
- `api/plugins-api.types.ts` — provider-settings wire types only; nothing injected. The plugin row, the
  package-files envelope and the install conflict come from Core's `contracts/site` declarations.
- `hooks/plugins-port.hooks.ts`, `hooks/plugin-install-port.hooks.ts`,
  `hooks/agent-plugin-memory-port.hooks.ts` — port interfaces; the host implements them over its
  own API clients and passes the implementation to the hooks that consume them.
- `hooks/use-plugin-row-focus.hooks.ts` — the host passes `focused` and, as the required
  `summarySelector`, the CSS selector of its row's summary button; it attaches the returned ref to
  its `<li>`.
- `PluginProviderSettingField.hooks.ts` — nothing injected; the host field passes the
  `field`, `value` and `onChange` it renders.
- `selected-skills.ts` — pure composer-skill selection rules; nothing injected.

`createPluginsApi`'s `listPlugins` returns Core's `AdminPluginDto` rows
(`@jini-ai/core/contracts/site/cms-plugins`), the same declaration the server routes serialize, and
`getPluginFiles` returns its `AdminPluginFilesEnvelope`; a row from a server predating `conflicts`
gets an empty list at that client boundary. `src/core/ports/plugins.ts`'s `AdminPlugin` is the
narrower, readonly port-level view for the extensions port; the two are different types on purpose.
