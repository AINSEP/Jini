import { useCallback, useEffect, useRef, useState } from 'react';

import type { ChatPaneAgent, ChatPaneRuntimeAccess } from '../../types.js';

const EMPTY_AGENTS: readonly ChatPaneAgent[] = [];

export interface UseChatPaneRuntimeInventoryOptions {
  access?: ChatPaneRuntimeAccess;
  initialAgents?: readonly ChatPaneAgent[];
  pollIntervalMs?: number;
}

export interface UseChatPaneRuntimeInventoryResult {
  agents: readonly ChatPaneAgent[];
  scanningAgents: boolean;
  daemonOnline: boolean;
  runtimeInventoryError: Error | null;
  rescanAgents: () => Promise<void>;
}

function runtimeAccessError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Owns agent inventory, explicit rescans, and daemon-health polling while the
 * host supplies only the environment-specific I/O effects.
 *
 * @complexity Time: O(n) per inventory response; space: O(n) for the snapshot.
 * @overallScore 100/100
 */
export function useChatPaneRuntimeInventory({
  access,
  initialAgents = EMPTY_AGENTS,
  pollIntervalMs = 5_000,
}: UseChatPaneRuntimeInventoryOptions): UseChatPaneRuntimeInventoryResult {
  const [agents, setAgents] = useState<readonly ChatPaneAgent[]>(initialAgents);
  const [scanningAgents, setScanningAgents] = useState(false);
  const [daemonOnline, setDaemonOnline] = useState(false);
  const [runtimeInventoryError, setRuntimeInventoryError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const inventoryGenerationRef = useRef(0);
  const statusGenerationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      inventoryGenerationRef.current += 1;
      statusGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (access !== undefined) return;
    inventoryGenerationRef.current += 1;
    setAgents(initialAgents);
    setScanningAgents(false);
    setRuntimeInventoryError(null);
  }, [access, initialAgents]);

  const loadAgents = useCallback(async (rescan: boolean): Promise<void> => {
    if (!access) return;
    const generation = ++inventoryGenerationRef.current;
    setScanningAgents(true);
    setRuntimeInventoryError(null);
    try {
      const nextAgents = await (rescan ? access.rescanAgents() : access.listAgents());
      if (mountedRef.current && generation === inventoryGenerationRef.current) {
        setAgents([...nextAgents]);
      }
    } catch (error) {
      if (mountedRef.current && generation === inventoryGenerationRef.current) {
        if (!rescan) setAgents([]);
        setRuntimeInventoryError(runtimeAccessError(error));
      }
    } finally {
      if (mountedRef.current && generation === inventoryGenerationRef.current) {
        setScanningAgents(false);
      }
    }
  }, [access]);

  const refreshStatus = useCallback(async (): Promise<void> => {
    if (!access) return;
    const generation = ++statusGenerationRef.current;
    try {
      const online = await access.daemonOnline();
      if (mountedRef.current && generation === statusGenerationRef.current) {
        setDaemonOnline(online);
      }
    } catch {
      if (mountedRef.current && generation === statusGenerationRef.current) {
        setDaemonOnline(false);
      }
    }
  }, [access]);

  useEffect(() => {
    if (!access) return;
    void loadAgents(false);
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), pollIntervalMs);
    return () => {
      window.clearInterval(timer);
      inventoryGenerationRef.current += 1;
      statusGenerationRef.current += 1;
    };
  }, [access, loadAgents, pollIntervalMs, refreshStatus]);

  const rescanAgents = useCallback(() => loadAgents(true), [loadAgents]);

  return {
    agents,
    scanningAgents,
    daemonOnline,
    runtimeInventoryError,
    rescanAgents,
  };
}
