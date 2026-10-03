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
