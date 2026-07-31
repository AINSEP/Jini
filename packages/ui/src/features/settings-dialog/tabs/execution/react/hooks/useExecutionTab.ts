import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExecutionPort } from '../../ports.js';
import { sortDetectedAgents } from '../../rules.js';
import type {
  AgentScanState,
  ByokConfig,
  ConnectionTestState,
  DetectedAgent,
  ModelDiscoveryState,
} from '../../types.js';

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
  rescan: () => void;
  testConnection: (config: ByokConfig) => void;
  loadModels: (config: ByokConfig) => void;
  canRescan: boolean;
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

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const runDetection = useCallback(
    (detect: () => Promise<readonly DetectedAgent[]>) => {
      setScan({ status: 'scanning' });
      detect().then(
        (found) => {
          if (!alive.current) return;
          const sorted = sortDetectedAgents(found);
          setAgents(sorted);
          setScan({ status: 'ok', count: sorted.filter((agent) => agent.installed).length });
        },
        (error: unknown) => {
          if (!alive.current) return;
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
      setConnectionTest({ status: 'testing' });
      port.testConnection(config).then(
        (result) => {
          if (!alive.current) return;
          setConnectionTest(
            result.ok
              ? { status: 'ok', message: result.message }
              : { status: 'error', message: result.message ?? 'Connection failed' },
          );
        },
        (error: unknown) => {
          if (!alive.current) return;
          setConnectionTest({
            status: 'error',
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
      setModelDiscovery({ status: 'loading' });
      listModels.call(port, config).then(
        (found) => {
          if (!alive.current) return;
          setModelDiscovery({ status: 'ok', models: found });
        },
        (error: unknown) => {
          // Error-reporting contract §3.2: non-blocking ≠ silent. The Model
          // field stays usable (the component still falls back to the
          // preset's `preferredModels` when `modelDiscovery.status !== 'ok'`)
          // but the failure itself is a real, renderable state — auth
          // failures, timeouts, and unreachable endpoints are all operator-
          // actionable and must not read as "this provider has no models."
          if (!alive.current) return;
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
    rescan,
    testConnection,
    loadModels,
    canRescan: typeof port.rescanLocalAgents === 'function',
  };
}
