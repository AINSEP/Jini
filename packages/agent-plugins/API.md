# Plugin lifecycle effects

`createAgentPluginLifecycle(required, optional = {})` accepts a native fs/promises operation
subset and native FileHandles. Native callbacks/handles keep the Node ABI. The opt-in
`createNodeAgentPluginEffects({}, { filesystem? })` returns injected filesystem effects directly.

Clock effects extend core `Clock` with `monotonicMs()` and `sleep({ ms })`; ID effects extend
core `IdGenerator` with `random()`. Core getters are zero-argument: `nowMs()` / `newId()`.

Generic locks are separate from lifecycle: import `withFileLock`, `HeldFileLock`, holder/error
contracts and constants from `@jini-ai/platform/fs/file-lock`. Activation passes 15000ms timeout,
10000ms staleness and 10ms polling. Staleness uses age or a dead local pid, with unchanged
inode/device/bytes/mtime before removal; publication checks `assertHeld({})` before rename.
The lifecycle maps shared timeout/lost errors to AgentPluginActivationsBusyError.

Only neutral bundled plugin assets are shipped; product-specific theme assets belong to products.

## Partial lifecycle composition

`createAgentPluginActivations(required, optional)` needs only the native filesystem,
clock, id and process effects. Bind it once and retain the returned object so every
writer shares the same per-workspace queue. Its readers take `{ workspaceRoot }`,
activation verdicts take `{ workspaceRoot, pluginId }`, and filters take
`{ activations, items, pluginIdOf: ({ item }) => item.pluginId }`. `onEvent` belongs
to the second object and receives stale-lock diagnostics. Strict capability verdicts,
raw sibling preservation, lock ownership checks and fsync behavior are unchanged.

The optional manifest `readServerMetadata` reader receives `{ serverId, value, server }`.
`value` is the declared extension object or an empty object; `server` is the raw transport
entry. A host can translate legacy metadata without changing the generic parser. Every
translated field still passes through the bounded metadata validators. A malformed
non-object declared extension excludes that server before the reader runs. With no
reader, transport-entry metadata remains ignored.
