# Sidecar API

Public calls use `(requiredArgs, optionalArgs?)`. Required data and dependency ports belong in the first object; optional policy belongs in the second. Generic export names are retained; Node supervisor defaults moved to their isolated subpath. This is a breaking signature change; the full legacy-helper inventory is in the archived migration inventory.

| Entry | Runtime | API |
| --- | --- | --- |
| `@jini-ai/sidecar` | Node | Existing IPC, registry, paths and bootstrap helpers, plus the policy/supervisor exports below |
| `@jini-ai/sidecar/respawn-policy` | Universal | `createRespawnPolicy({ now }, { backoffScheduleMs?, crashLoopWindowMs?, crashLoopMaxFailures?, portConflictMaxAttempts? })` |
| `@jini-ai/sidecar/supervisor` | Universal | `createDaemonSupervisor(requiredPorts, optionalPolicy)` |
| `@jini-ai/sidecar/supervisor/node` | Node | `createNodeDaemonProcessAdapter(requiredLaunch, optionalSinks)`, `createSupervisorRegistry({ registryPath })`, `createNodeSupervisorScheduler({})` |

The supervisor requires `spawnDaemonProcess`, `terminateProcess`, `policy`, `now`, `scheduler`, `classifyExit`, `failureReporter` and `logger`. Supply the process command, arguments, working directory, environment and registry to the Node adapter. Construction does not start a process. Keep one supervisor instance per managed child.

The child port receives `on({ event: 'exit', listener: ({ code, signal }) => ... })`, `on({ event: 'error', listener: ({ error }) => ... })` and `kill({}, { signal? })`. Native Node events/signals are translated inside the adapter. No-argument lifecycle actions (`start`, `restart`, `ensureStarted`, `shutdown`) carry no data.

Registry calls are `readLiveDaemonRegistryRecord({ registryPath })`, `writeDaemonRegistryRecord({ registryPath, record })` and `removeDaemonRegistryRecordIfCurrent({ registryPath, pid })`. The bound registry port exposes `readLive()`, `write({ record })` and `removeIfCurrent({ pid })`.

All product paths, environment names, stamp normalizers and exit classification are host inputs. A scheduler must defer its callback until after `schedule` returns. Restart waits for child exit and termination completion; shutdown prevents pending retries from spawning another child.

Dependencies: `@jini-ai/core` and `@jini-ai/platform`. The platform adapter still calls platform's existing signatures internally; it does not change that package's APIs.

## Isolated supervisor Node defaults

`@jini-ai/sidecar/supervisor` exports only the generic process-port supervisor
and its types. `createNodeDaemonProcessAdapter`, `createSupervisorRegistry`,
`createNodeSupervisorScheduler` and the adapter types are exported exclusively
from `@jini-ai/sidecar/supervisor/node`. They are no longer re-exported from the
root or generic entry. Generic supervisor construction still requires the same
process, clock, scheduler and reporting ports and starts no work on import.
