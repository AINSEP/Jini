import { describe, expect, it } from 'vitest';
import * as daemon from '../index.js';

// The package barrel is a pure re-export surface (event-log/close-status/
// run-lifecycle/tool-executor/delegated-tool-bridge/agent-executor/tokens/
// legacy-data-migration/run) — mirrors src/run/__tests__/index.test.ts's own
// precedent: importing it here executes its own `export * from` statements
// (and, transitively, the run/ sub-barrel's own chain down through
// run/core/index.ts and run/diagnostics/index.ts) under coverage, and
// asserts the public value API is actually present at the top level.
describe('package barrel', () => {
  it('re-exports every top-level value across the kernel modules it aggregates', () => {
    const expected = [
      // event-log.ts
      'createInMemoryEventLog',
      // close-status.ts
      'classifyRunCloseStatus',
      'resolveTimeoutMs',
      'createInactivityWatchdog',
      // run-lifecycle.ts
      'createRunLifecycle',
      // tool-executor.ts
      'createToolExecutor',
      // delegated-tool-bridge.ts
      'serializeDelegatedToolOutput',
      'createDelegatedToolBridge',
      // frontend-session-registry.ts
      'createFrontendSessionRegistry',
      // agent-executor.ts
      'isSupportedStreamFormat',
      'translateAgentRuntimeEvent',
      'AgentExecutorError',
      'createAgentExecutor',
      // tokens.ts
      'RunLifecycleToken',
      'EventLogToken',
      'ToolExecutorToken',
      'AgentExecutorToken',
      // legacy-data-migration.ts
      'LegacyMigrationError',
      'dataDirIsEmptyOrFresh',
      'legacyDirHasPayload',
      'dataDirHasExistingPayload',
      'promoteStaged',
      'migrateLegacyDataDirSync',
      // run/index.js, transitively re-exported — proves the nested barrel
      // chain (run/index.ts -> run/core/index.ts -> result.ts, etc.) is
      // reachable from this package's own public entry point.
      'runResultFromStatus',
    ] as const;
    for (const name of expected) {
      expect(daemon[name as keyof typeof daemon]).toBeDefined();
    }
  });
});
