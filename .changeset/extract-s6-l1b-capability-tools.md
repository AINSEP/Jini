---
"@jini-ai/plugins": minor
---

Publish the plugin capability-tool registrar on `@jini-ai/plugins/host`:
`createPluginCapabilityTools(required, {})` returns `loadSources`, `buildRegistrations` and
`registerEnabled` for one read-only `plugin_capability_<id>` tool per enabled, field-declaring
plugin, plus `pluginCapabilityToolDerivedRisk({ sources }, {})`. Hosts supply the identity
namespace, every model-facing sentence (`PluginCapabilityToolText`), the catalog domain, path and
metadata, the read permission and entity scope (one object, published and enforced), the
executable-tool permission and metadata, the approval family and port, and the preview draft.
