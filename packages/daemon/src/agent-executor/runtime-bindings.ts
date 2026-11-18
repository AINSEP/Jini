import { collectProcessTreePids, planCommandInvocation, type CommandInvocation, type ProcessControlPort } from '@jini-ai/core/contracts/runtime';
import type { AgentExecutorRuntimePorts } from '../ports/runtime.js';
import type { TerminateChildTreeDeps } from './contracts.js';

/**
 * The executor's process-tree cleanup deps, over the host's `ProcessControlPort`. Each member keeps the
 * argument shape the cleanup code already calls: discovery is a getter (called once per cancel, never per
 * event), collection is core's pure walk, and stopping hands the port its `{ pids }` object.
 * @complexity O(1) construction; a call costs what the port's function costs.
 */
export function createProcessTreeDeps({ processes }: { readonly processes: ProcessControlPort }, _optional: Record<string, never> = {}): TerminateChildTreeDeps {
  return {
    listProcessSnapshots: () => processes.listProcessSnapshots({}, {}),
    collectProcessTreePids: ({ processes: snapshots, rootPids }) => collectProcessTreePids(snapshots, rootPids),
    stopProcesses: ({ pids }) => processes.stopProcesses({ pids }),
  };
}

/**
 * Plans the concrete `{ command, args }` to spawn with core's pure planner, using the platform and
 * fallback `ComSpec` the host stated. There is no command port: the planner is a pure function, and a port
 * in front of it has one implementation and one more way to be bound wrong (args sit in the second object).
 * @complexity O(a) in the argument count on a win32 `.cmd` shim, O(1) otherwise.
 */
export function createCommandPlanner({ commandShell }: { readonly commandShell: AgentExecutorRuntimePorts['commandShell'] }, _optional: Record<string, never> = {}) {
  return ({ command, args, env }: { readonly command: string; readonly args: string[]; readonly env: NodeJS.ProcessEnv }): CommandInvocation =>
    planCommandInvocation({ command, platform: commandShell.platform, env }, { args, fallbackComSpec: commandShell.fallbackComSpec });
}
