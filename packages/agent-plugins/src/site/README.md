# `src/site`

Generic plugin-host pieces extracted from a site host. Everything product-specific is injected.

## Wiring

- `retired-plugin-tool-aliases.ts` (`./site/retired-plugin-tool-aliases`): the host injects `replacements`
  (its retired plugin id -> successor catalog) and `toToolId` (its plugin id -> tool id rule) on the
  existing `required` object, at the composition root that registers the agent-plugin tool family.
- `deploy-split-activation.ts` (`./site/deploy-split-activation`): the host injects `activations`
  (its lifecycle owner's activation calls) and runs it before bundled seeding.
- `admin-surfaces/` (`./site/admin-surfaces/*`): see that folder's README.
- `customize-tool.ts` (`./site/customize-tool`): the host injects `lifecycle` (its lifecycle owner's
  `listInstalledPlugins`, `readBundledAgentPluginDigests`, `preferBundledAgentPluginDigests`,
  `maxAgentPluginInstallArchiveBytes`) on the existing args object; the host keeps the tool definition and
  its model-facing copy, and calls this from its install tool after authorization.
- `activation-effects.ts` (`./site/activation-effects`): the host injects `resolveAgentPluginActivation`
  (its lifecycle owner's activation resolution, so all writers share one queue) next to `workspaceRoot`.
- `provider-plugin-link.ts` (`./site/provider-plugin-link`): the host injects `activations` (its lifecycle
  owner's `reconcileAgentPluginActivation` / `readAgentPluginActivations` / `isAgentPluginActive`) and `catalog`
  (`list`, `bundled`, `preferBundled`, `read`) into `bindProviderFacePorts`, and a required `warn` sink into
  `followProviderActivations`; the host keeps its linked-face refusal error (its copy names the host's switch).
- `host-plugin-guidance.ts` (`./site/host-plugin-guidance`): the host injects `overlaysDir` (its shipped overlays)
  on every reader's required args, and `isYamlMapping` (its failsafe YAML reader) into
  `removeChatRefusedToolPermissions` / `deliverHostPluginGuidance`.
- `service-ports.ts` (`./site/service-ports`): types only; `AgentPluginApiConnectionsPort<TConnection>` is
  instantiated with the host's declared-connection record.
