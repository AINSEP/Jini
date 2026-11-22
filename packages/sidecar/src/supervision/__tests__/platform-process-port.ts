import type { ProcessControlPort } from "@jini-ai/core/contracts/runtime";
import { listProcessSnapshots, stopProcesses, waitForProcessExit } from "@jini-ai/platform/process";

/**
 * Test-only: the real process functions behind the object-shaped port (platform is a test dependency of
 * sidecar). Hosts pass `createProcessControlPort` from `@jini-ai/node-adapters/process`, which maps the same way;
 * sidecar cannot import it (a domain package never imports a runtime adapter).
 */
export const platformProcessPort: ProcessControlPort = {
  listProcessSnapshots: (_required = {}, optional = {}) => listProcessSnapshots({}, optional),
  stopProcesses: ({ pids }) => stopProcesses([...pids]),
  waitForProcessExit: ({ pid }, { timeoutMs } = {}) => waitForProcessExit(pid, timeoutMs),
};
