# `@jini-ai/agent-runtime/inventory`

The agent-CLI picker's inventory: a cached lister that turns the host's agent defs into neutral
`AgentInventorySummary` rows (`@jini-ai/core/contracts/agents/inventory`), installed runtimes first.

## Wiring

Architecture: [`extraction-plan.md`](../../../../ADS-memory/reports/jini-port/extraction-plan.md).

- **Needs injected (`AgentRuntimePorts`):** `defs` (the runtime defs to consider), `resolveLaunch` (where a
  def's CLI is, or a diagnostic why not), `probeModels` (the live model list for an installed CLI) and
  `supportsTools` (the host's eligibility rule, e.g. "can load the host's MCP bridge") and `orFallback` (the
  host's fallback idiom, e.g. Core's `orFallback`, used when a model probe fails).
- **Provides:** `createAgentInventory(ports)` returning `({ rescan }) => Promise<AgentInventorySummary[]>`, cached
  once per process until `rescan: true`; a failed probe is never cached. `summarizeAgent({ def, ports })` builds one row.
- **Never imports:** a host's IPC/HTTP transport, channel names, product copy, or another `@jini-ai/*` package's
  implementation (only `@jini-ai/core` contract types; the fallback idiom arrives as `orFallback`).

```ts
import { createAgentInventory } from "@jini-ai/agent-runtime/inventory";

const listAgents = createAgentInventory({
  defs: runtimeDefs,
  resolveLaunch: ({ def }) => resolveAgentLaunch({ def }),
  probeModels: ({ def }) => probeAgentModels({ def }),
  supportsTools: ({ def }) => def.mcpDiscovery !== undefined,
  orFallback, // e.g. from "@jini-ai/core/errors/idioms"
});
ipc.handle("agents:list", () => listAgents({ rescan: false }));
ipc.handle("agents:rescan", () => listAgents({ rescan: true }));
```
