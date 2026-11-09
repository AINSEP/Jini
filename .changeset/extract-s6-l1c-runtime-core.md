---
"@jini-ai/plugins": minor
---

Add `createPluginRuntimeCore(required, optional)` and its port types (`PluginRuntimeSource`, `PluginRuntimeHostBinding`, `PluginRuntimeTracker`, `PluginRuntimeLookup`, `PluginRuntimeText`, `PluginRuntimeCoreRequired`/`Optional`/`Bindings`) plus `PluginUninstallPathError` to `@jini-ai/plugins/host/node`: the plugin runtime core (discovery, conflict gates, enable/load/attach, boot re-attach, provider admission, install/source/reload wiring) with every host value injected.
