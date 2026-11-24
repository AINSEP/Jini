# runtime

Host-independent plugin-runtime pieces: install consent copy, tool ids, consumer-owned service ports
and the tool-access lowering step.

## Wiring

- `lowerPluginToolAccess({ ..., LoweringError })`: the host passes its own "OFF saved, stop not
  confirmed" error class as `LoweringError` (its routes match it by identity) and its roster-change
  notifier as `notifyRosterChanged`.
- `PluginPostReadPort` / `PluginProviderFacesPort`: interfaces only; the host composition implements
  them and hands them to the tool bindings that consume them.
