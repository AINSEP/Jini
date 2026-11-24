# runtime

Host-independent plugin-runtime pieces: install consent copy, tool ids, consumer-owned service ports
and the tool-access lowering step.

## Wiring

- `./runtime/sdk-resolver` — `registerPluginSdkResolver({ sdkModulePath })` registers the once-per-process SDK module-resolution hook; the host resolves its own SDK build and passes the absolute `sdkModulePath` (required, never defaulted from Jini's dist).
- `lowerPluginToolAccess({ ..., LoweringError })`: the host passes its own "OFF saved, stop not
  confirmed" error class as `LoweringError` (its routes match it by identity) and its roster-change
  notifier as `notifyRosterChanged`.
- `PluginPostReadPort` / `PluginProviderFacesPort`: interfaces only; the host composition implements
  them and hands them to the tool bindings that consume them.
