import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExecutionPort } from '@jini-ai/ui-core';
import { sortDetectedAgents } from '@jini-ai/ui-core';
import type {
  AgentScanState,
  AgentTestState,
  ByokConfig,
  ConnectionTestState,
  DetectedAgent,
  ModelDiscoveryState,
} from '@jini-ai/ui-core';

export interface UseExecutionTabOptions {
  port: ExecutionPort;
  /** Skips the mount-time detection call — useful when the host already has
   *  agents in hand, or when the tab is rendered but not visible. */
  autoDetect?: boolean;
}

export interface UseExecutionTabResult {
  agents: readonly DetectedAgent[];
  scan: AgentScanState;
  connectionTest: ConnectionTestState;
  /** Result of the most recent `loadModels` call. `{status:'idle'}` until one
   *  runs. A `'error'` state is a real, renderable failure — distinct from
   *  `'ok'` with an empty list — see `ModelDiscoveryState`'s doc. */
  modelDiscovery: ModelDiscoveryState;
  /** Result of the most recent per-agent Test. Carries the `agentId` it
   *  belongs to so a card only renders its OWN result — without that, testing
   *  one agent and then selecting another would show the first agent's verdict
   *  under the second one's card. */
  agentTest: AgentTestState;
  rescan: () => void;
  testConnection: (config: ByokConfig) => void;
  testAgent: (agentId: string, model?: string | undefined) => void;
  loadModels: (config: ByokConfig) => void;
  canRescan: boolean;
  canTestAgent: boolean;
}

/**
 * Owns the tab's async edges: local-agent detection, rescan, connection test,
 * and optional model discovery. Config state itself stays with the host — the
 * tab is controlled, so a host can persist to its own store on every change.
 *
 * Every async result is dropped if the hook unmounted first, so a slow probe
 * can't set state on a torn-down tree.
 */
export function useExecutionTab({ port, autoDetect = true }: UseExecutionTabOptions): UseExecutionTabResult {
  const [agents, setAgents] = useState<readonly DetectedAgent[]>([]);
  const [scan, setScan] = useState<AgentScanState>({ status: 'idle' });
  const [connectionTest, setConnectionTest] = useState<ConnectionTestState>({ status: 'idle' });
  const [modelDiscovery, setModelDiscovery] = useState<ModelDiscoveryState>({ status: 'idle' });
  const [agentTest, setAgentTest] = useState<AgentTestState>({ status: 'idle' });

  /*
   * One monotonic ticket per async edge.
   *
   * `alive` alone is NOT enough: it only stops a result landing after UNMOUNT,
   * and says nothing about ORDER. Every edge here can be launched again before
   * the previous call settles — the operator switches provider mid-discovery,
   * clicks Test twice, rescans while a scan is running — and responses are not
   * guaranteed to return in the order they were sent. Without a ticket the
   * slower FIRST response lands last and overwrites the newer one, so the form
   * shows provider A's models under provider B, or A's failure hides B's
   * success. Only the newest ticket for an edge may write its state.
   */
  const detectionTicket = useRef(0);
  const connectionTestTicket = useRef(0);
  const agentTestTicket = useRef(0);
  const modelDiscoveryTicket = useRef(0);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const runDetection = useCallback(
    (detect: () => Promise<readonly DetectedAgent[]>) => {
      const ticket = ++detectionTicket.current;
      const isCurrent = () => alive.current && detectionTicket.current === ticket;
      setScan({ status: 'scanning' });
      detect().then(
        (found) => {
          if (!isCurrent()) return;
          const sorted = sortDetectedAgents(found);
          setAgents(sorted);
          setScan({ status: 'ok', count: sorted.filter((agent) => agent.installed).length });
        },
        (error: unknown) => {
          if (!isCurrent()) return;
          setScan({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        },
      );
    },
    [],
  );

  useEffect(() => {
    if (!autoDetect) return;
    runDetection(() => port.detectLocalAgents());
  }, [autoDetect, port, runDetection]);

  const rescan = useCallback(() => {
    const rescanFn = port.rescanLocalAgents;
    if (!rescanFn) return;
    runDetection(() => rescanFn.call(port));
  }, [port, runDetection]);

  const testConnection = useCallback(
    (config: ByokConfig) => {
      const ticket = ++connectionTestTicket.current;
      const isCurrent = () => alive.current && connectionTestTicket.current === ticket;
      setConnectionTest({ status: 'testing' });
      port.testConnection(config).then(
        (result) => {
          if (!isCurrent()) return;
          setConnectionTest(
            result.ok
              ? { status: 'ok', message: result.message }
              : { status: 'error', message: result.message ?? 'Connection failed' },
          );
        },
        (error: unknown) => {
          if (!isCurrent()) return;
          setConnectionTest({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        },
      );
    },
    [port],
  );

  const testAgent = useCallback(
    (agentId: string, model?: string | undefined) => {
      const run = port.testAgent;
      if (!run) return;
      const ticket = ++agentTestTicket.current;
      const isCurrent = () => alive.current && agentTestTicket.current === ticket;
      setAgentTest({ status: 'testing', agentId });
      run.call(port, agentId, model).then(
        (result) => {
          if (!isCurrent()) return;
          setAgentTest(
            result.ok
              ? {
                  status: 'ok',
                  agentId,
                  message: result.message,
                  // Passed through (not derived) so `agentExecutableRepairState`
                  // can only ever act on what the host's own probe actually
                  // reported — see `ExecutionPort.testAgent`'s doc.
                  usedExecutableSource: result.usedExecutableSource,
                  detectedExecutablePath: result.detectedExecutablePath,
                }
              : { status: 'error', agentId, message: result.message ?? 'Agent check failed' },
          );
        },
        (error: unknown) => {
          if (!isCurrent()) return;
          setAgentTest({
            status: 'error',
            agentId,
            message: error instanceof Error ? error.message : String(error),
          });
        },
      );
    },
    [port],
  );

  const loadModels = useCallback(
    (config: ByokConfig) => {
      const listModels = port.listModels;
      if (!listModels) return;
      const ticket = ++modelDiscoveryTicket.current;
      const isCurrent = () => alive.current && modelDiscoveryTicket.current === ticket;
      setModelDiscovery({ status: 'loading' });
      listModels.call(port, config).then(
        (found) => {
          if (!isCurrent()) return;
          setModelDiscovery({ status: 'ok', models: found });
        },
        (error: unknown) => {
          // Error-reporting contract §3.2: non-blocking ≠ silent. The Model
          // field stays usable (the component still falls back to the
          // preset's `preferredModels` when `modelDiscovery.status !== 'ok'`)
          // but the failure itself is a real, renderable state — auth
          // failures, timeouts, and unreachable endpoints are all operator-
          // actionable and must not read as "this provider has no models."
          if (!isCurrent()) return;
          setModelDiscovery({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        },
      );
    },
    [port],
  );

  return {
    agents,
    scan,
    connectionTest,
    modelDiscovery,
    agentTest,
    rescan,
    testConnection,
    testAgent,
    loadModels,
    canRescan: typeof port.rescanLocalAgents === 'function',
    canTestAgent: typeof port.testAgent === 'function',
  };
}
