/**
 * `@injini/core` DI tokens for this package's kernel services, per
 * extraction-plan §2.2 ("Kernel exports only kernel-service tokens... every
 * other token lives in its owning feature package") — `RunLifecycle`,
 * `EventLog`, and `ToolExecutor` are themselves kernel nouns (§2.1), so
 * their tokens are defined here, alongside the services, rather than in
 * `@injini/core` itself. A pack composes against them the same way
 * `packages/core/src/index.test.ts` demonstrates for its own example tokens.
 *
 * `ArtifactStoreToken` used to live here too — moved to `@injini/artifacts`'s own
 * `tokens.ts` on 2026-07-19 (see that file's doc comment) after the swarm-consensus
 * architecture debate found it violated §2.1's "NO ... artifacts ... in the kernel" rule.
 */
import { token } from '@injini/core';
import type { EventLog } from './event-log.js';
import type { RunLifecycle } from './run-lifecycle.js';
import type { ToolExecutor } from './tool-executor.js';
import type { AgentExecutor } from './agent-executor.js';

export const RunLifecycleToken = token<RunLifecycle>('jini.runLifecycle');
export const EventLogToken = token<EventLog>('jini.eventLog');
export const ToolExecutorToken = token<ToolExecutor>('jini.toolExecutor');
export const AgentExecutorToken = token<AgentExecutor>('jini.agentExecutor');
