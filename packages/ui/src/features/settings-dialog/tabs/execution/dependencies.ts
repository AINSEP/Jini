import type { ExecutionPort } from './ports.js';
import type { ByokConfig, DetectedAgent } from './types.js';

export interface FakeExecutionPortOptions {
  agents?: readonly DetectedAgent[];
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
  /** Simulated latency in ms; 0 (default) resolves synchronously. */
  latencyMs?: number;
}

const DEFAULT_FAKE_AGENTS: readonly DetectedAgent[] = [
  { id: 'agent-a', label: 'Example Agent CLI', installed: true, version: '1.4.0', path: '/usr/local/bin/agent-a' },
  { id: 'agent-b', label: 'Another Agent CLI', installed: false },
];

/**
 * In-memory test/demo double, per this package's convention of shipping a fake
 * rather than a real transport (see `features/connectors/dependencies.ts`).
 */
export function createFakeExecutionPort(options: FakeExecutionPortOptions = {}): ExecutionPort {
  const agents = options.agents ?? DEFAULT_FAKE_AGENTS;
  const latencyMs = options.latencyMs ?? 0;
  const delay = <T>(value: T): Promise<T> =>
    latencyMs > 0 ? new Promise((resolve) => setTimeout(() => resolve(value), latencyMs)) : Promise.resolve(value);
  const delayedRejection = (message: string): Promise<never> =>
    latencyMs > 0
      ? new Promise((_resolve, reject) => setTimeout(() => reject(new Error(message)), latencyMs))
      : Promise.reject(new Error(message));

  return {
    detectLocalAgents() {
      if (options.agentsError) return delayedRejection(options.agentsError);
      return delay(agents.map((agent) => ({ ...agent })));
    },
    rescanLocalAgents() {
      if (options.agentsError) return delayedRejection(options.agentsError);
      return delay(agents.map((agent) => ({ ...agent })));
    },
    testConnection(config: ByokConfig) {
      if (options.testResult) return delay({ ...options.testResult });
      const ok = Boolean(config.apiKey.trim() && config.baseUrl.trim() && config.model.trim());
      return delay(
        ok ? { ok: true, message: 'Connection succeeded' } : { ok: false, message: 'Missing credentials' },
      );
    },
    listModels() {
      if (options.modelsError) return delayedRejection(options.modelsError);
      return delay([...(options.models ?? ['example-model-large', 'example-model-small'])]);
    },
  };
}
