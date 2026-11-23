---
"@jini-ai/plugins": patch
---

Add `./runtime/{agent-tools,plugin-tool-messages,source-tool-catalog,install-tool-catalog,capability-card,plugin-host-copy}` (model-facing plugin catalogs and messages; the host passes its product copy as `PluginHostCopy`, its install-source schema and its plugins admin href) and `./site/{lipay,store}/manifest` (bundled first-party data-module declarations). BREAKING for existing installs: the lipay/store provenance publisher is now `"jini-core"` (was `"tovu-core"`); `_plugin_identity` rows recorded with the old publisher no longer match.
