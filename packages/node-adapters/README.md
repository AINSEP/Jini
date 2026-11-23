# `@jini-ai/node-adapters`

Node bindings of the engine's runtime ports over [`@jini-ai/platform`](../platform) functions
(owner decision OD-3, package kind `runtime-adapter`). Exports bindings only and assembles nothing:
a host, or a host preset such as `@jini-ai/server`, imports a binding and hands it to the domain that
declares the port.

```sh
npm install @jini-ai/node-adapters
```

There is no root entry. Import the binding family you need:

| Entry | Exports | Binds |
| --- | --- | --- |
| `@jini-ai/node-adapters/fs` | `nodeFileLock`, `nodeAtomicWriter` | core's `FileLockPort` and `AtomicFileWriterPort` |
| `@jini-ai/node-adapters/process` | `nodeProcessControl`, `createProcessControlPort` (and the `ProcessFunctions` type), `createSpawnPort`, `nodeSpawnPort`, `nodeCommandShell` | core's `ProcessControlPort`, the spawn port, the command planner's inputs |
| `@jini-ai/node-adapters/agent-plugins` | `createNodeAgentPluginEffects` (and the `AgentPluginPlatformFunctions` type) | the agent-plugin lifecycle's native effects |

`createProcessControlPort({ functions })` takes the three platform process functions injected (the host
passes `@jini-ai/platform/process`'s; this package imports no other package's implementation), and a
test passes recording fakes: two port members take their arguments in a different shape from the
function they wrap (`{ pids }` vs a positional array, `{ pid }` vs a positional pid).

## Rules this package obeys (enforced by `pnpm guard`)

- Imports only `@jini-ai/core`, `@jini-ai/protocol` and `@jini-ai/platform`; it may name a domain's port
  types (type-only, declared as a peer) but never runs a domain's code.
- Only a host or a host preset imports it; it never imports a host preset.
- No root barrel; each later binding family (agent plugins, http, agent runtime) adds its own entry,
  source file and test in its own commit.
- The vendor binding `node-pty` stays in `@jini-ai/server`: moving it here would give every importer a
  native build.
