import type { AtomicFileWriterPort, FileLockPort, ProcessControlPort, RuntimePlatform } from '@jini-ai/core/contracts/runtime';
import type { ProcessSpawnPort } from './process.js';

/** The OS-facing things one agent executor needs. All required: daemon has no default for any of them. */
export interface AgentExecutorRuntimePorts {
  readonly spawn: ProcessSpawnPort;
  readonly processes: ProcessControlPort;
  readonly fileLock: FileLockPort;
  readonly writer: AtomicFileWriterPort;
  /**
   * Inputs of core's pure `planCommandInvocation`. The host states them; daemon never reads
   * `process.platform` or the ambient `ComSpec`. There is no command port: the planner is a pure
   * function in core, and a port in front of it has one implementation and one more way to be bound wrong.
   */
  readonly commandShell: { readonly platform: RuntimePlatform; readonly fallbackComSpec: string | undefined };
}
