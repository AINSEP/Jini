import { fakeLatencyDelay } from '../../utils/fake-latency.js';
import type { AgentExecutableSource, ByokConfig, ExecutionCardAgent, ExecutionPort } from '@jini-ai/core/contracts/execution';

export interface FakeExecutionPortOptions {
  agents?: readonly ExecutionCardAgent[];
  models?: readonly string[];
  /** When set, `detectLocalAgents`/`rescanLocalAgents` REJECT with this message
   *  instead of resolving `agents` — exercises the "detection itself failed"
   *  path (`AgentScanState`'s `'error'` state), distinct from "found nothing". */
  agentsError?: string;
  /** When set, `listModels` REJECTS with this message instead of resolving
   *  `models` — exercises the "discovery itself failed" path
   *  (`ModelDiscoveryState`'s `'error'` state), distinct from "found none". */
  modelsError?: string;
  /** Forces the connection-test verdict. Defaults to "ok when every required
   *  credential is non-blank", which is enough to demo both branches. */
  testResult?: { ok: boolean; message?: string };
  /** Forces the per-agent Test verdict. Defaults to "ok when the agent is
   *  detected and installed". `usedExecutableSource`/`detectedExecutablePath`
   *  let a caller exercise `agentExecutableRepairState`'s repair affordance
   *  through the fake port end-to-end. */
  agentTestResult?: {
    ok: boolean;
    message?: string;
    usedExecutableSource?: AgentExecutableSource;
    detectedExecutablePath?: string;
  };
  /** When set, `testAgent` REJECTS with this message — the "the check could
   *  not run at all" branch, distinct from a reachable CLI reporting trouble. */
  agentTestError?: string;
  /** Simulated latency in ms; 0 (default) resolves synchronously. */
  latencyMs?: number;
}

const DEFAULT_FAKE_AGENTS: readonly ExecutionCardAgent[] = [
  {
    id: 'agent-a',
    label: 'Example Agent CLI',
    installed: true,
    version: '1.4.0',
    path: '/usr/local/bin/agent-a',
    description: 'Example vendor CLI',
    authStatus: 'ok',
    modelsSource: 'fallback',
    models: [
      { id: 'example-model-large', label: 'Example Large' },
      { id: 'example-model-small', label: 'Example Small' },
    ],
    badges: ['Official'],
  },
  { id: 'agent-b', label: 'Another Agent CLI', installed: false },
];

/**
 * In-memory test/demo double, per this package's convention of shipping a fake
 * rather than a real transport (see `features/connectors/dependencies.ts`).
 */
export function createFakeExecutionPort(options: FakeExecutionPortOptions = {}): ExecutionPort {
  const agents = options.agents ?? DEFAULT_FAKE_AGENTS;
  const latencyMs = options.latencyMs ?? 0;
  const delay = fakeLatencyDelay({}, { latencyMs });
  const delayedRejection = (message: string): Promise<never> =>
    latencyMs > 0
      ? new Promise((_resolve, reject) => setTimeout(() => reject(new Error(message)), latencyMs))
      : Promise.reject(new Error(message));

  return {
    detectLocalAgents() {
      if (options.agentsError) return delayedRejection(options.agentsError);
      return delay({ value: agents.map((agent) => ({ ...agent })) });
    },
    rescanLocalAgents() {
      if (options.agentsError) return delayedRejection(options.agentsError);
      return delay({ value: agents.map((agent) => ({ ...agent })) });
    },
    testConnection(config: ByokConfig) {
      if (options.testResult) return delay({ value: { ...options.testResult } });
      const ok = Boolean(config.apiKey.trim() && config.baseUrl.trim() && config.model.trim());
      return delay({
        value: ok ? { ok: true, message: 'Connection succeeded' } : { ok: false, message: 'Missing credentials' },
      });
    },
    testAgent(agentId: string) {
      if (options.agentTestError) return delayedRejection(options.agentTestError);
      if (options.agentTestResult) return delay({ value: { ...options.agentTestResult } });
      const agent = agents.find((candidate) => candidate.id === agentId);
      return delay({
        value: agent?.installed
          ? { ok: true, message: `${agent.label} is ready` }
          : { ok: false, message: `${agentId} is not installed` },
      });
    },
    listModels() {
      if (options.modelsError) return delayedRejection(options.modelsError);
      return delay({ value: [...(options.models ?? ['example-model-large', 'example-model-small'])] });
    },
  };
}
