# agent-plugins `site/`

Site-host pieces of Agent Plugins that a host binds at its composition root.

## Wiring

- `supersession.ts` (`./site/supersession`, node): trusted-replacement supersession read from the
  replacing plugin's own manifest. The host injects the `SupersessionManifestsPort` (installed
  manifest reader, and `createBundledSourceManifestReader({ bundledSourceRoot })` with its build's
  bundled source root) where it binds its lifecycle.
- `admin-surfaces/delivery-bindings.ts` (`./site/admin-surfaces/delivery-bindings`): the
  admin-surface `deliveryBindings` port. The host injects `SurfaceDeliveryBindingsDeps`: its site
  workspace id, declared connection ids, contributed form-destination adapter ids, forms list, the
  settings-backed `FormDeliveryBindingsStore`, `newBindingId`, and `deriveConnectionRef` (its
  api-connection key deriver, e.g. `deriveApiConnectionKey` from `@jini-ai/integrations/api-connections`,
  which this package may not import). Bound where the host composes its plugin connection seams.
- `uninstall-tool.ts` (`./site/uninstall-tool`, node): the Agent Plugin branch of a host's merged
  plugin-uninstall tool (permission, preview-or-refusal, confirmation, confirmed write). The host
  injects `uninstallHost` on its `AgentPluginUninstallToolDeps`: its lifecycle preview/uninstall owner,
  approval handler, not-confirmed result, dialog description and `AgentPluginUninstallCopy` (product
  name, its uninstall tool id, its external-MCP settings path). Bound at the call site where the host
  composes its plugin host.
