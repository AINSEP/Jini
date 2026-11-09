---
"@jini-ai/plugins": minor
---

Publish the per-load plugin invocation binding on `@jini-ai/plugins/host/node`:
`createPluginInvocationBinding({ pluginId, declaredHooks, beforeSaveHook }, {})` returns the
`coreDeps` for `buildCapabilityScopedSdk()` and the captured beforeSave filter, with
`content.read`/`content.extend` bound to the running filter through one AsyncLocalStorage per load.
Hosts supply their SDK's beforeSave hook id; entry and filter types are the plugin-domain
envelope from `@jini-ai/plugins/host`.
