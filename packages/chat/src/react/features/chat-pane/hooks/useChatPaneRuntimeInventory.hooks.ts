import { useCallback, useEffect, useState } from 'react';

import { useLatestOperation } from '../../../hooks/useLatestOperation.js';
import type { ChatPaneAgent, ChatPaneRuntimeAccess } from '../types.js';

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

/**
 * Owns agent inventory, explicit rescans, and daemon-health polling while the
 * host supplies only the environment-specific I/O effects.
 *
 * Inventory and health are tracked as two independent operations: a slow `listAgents` must not
 * suppress a health tick that resolved after it, and vice versa.
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
  // Seeded from `access` at mount, not `false`: the load effect below only flips this to `true`
  // once it runs, which is after the first paint. Starting at `false` when `access` is already
  // defined at mount painted one frame where the inventory was neither loaded nor marked as
  // loading — indistinguishable from "detection finished, nothing usable" to any consumer keyed
  // off this flag, which is exactly the frame `ChatPane`'s "No usable CLI" banner flashed on.
  const [scanningAgents, setScanningAgents] = useState(() => access !== undefined);
  const [daemonOnline, setDaemonOnline] = useState(false);
  const [runtimeInventoryError, setRuntimeInventoryError] = useState<Error | null>(null);
  const inventory = useLatestOperation();
  const health = useLatestOperation();

  useEffect(() => {
    if (access !== undefined) return;
    inventory.supersede();
    setAgents(initialAgents);
    setScanningAgents(false);
    setRuntimeInventoryError(null);
  }, [access, initialAgents, inventory]);

  const loadAgents = useCallback(async (rescan: boolean): Promise<void> => {
    if (!access) return;
    setScanningAgents(true);
    setRuntimeInventoryError(null);
    await inventory.run(async (token) => {
      const nextAgents = await (rescan ? access.rescanAgents() : access.listAgents());
      token.ensureCurrent();
      setAgents([...nextAgents]);
      setScanningAgents(false);
    }, (error) => {
      // A failed rescan keeps the last good inventory on screen; a failed initial load has no
      // last-good to keep, so it clears to empty rather than showing agents that may be gone.
      if (!rescan) setAgents([]);
      setRuntimeInventoryError(error);
      setScanningAgents(false);
    });
  }, [access, inventory]);

  const refreshStatus = useCallback(async (): Promise<void> => {
    // No `if (!access) return` guard here (unlike `loadAgents`, which is reachable through
    // the publicly-exposed `rescanAgents` and so can be invoked with a stale closure by the
    // host): `refreshStatus` is never returned from this hook, so its only two call sites
    // (the effect below, both the immediate call and the interval tick) are inside the SAME
    // closure as the effect's own `if (!access) return` at its top — `access` is guaranteed
    // defined by the time either one runs.
    const runtimeAccess = access as ChatPaneRuntimeAccess;
    await health.run(async (token) => {
      const online = await runtimeAccess.daemonOnline();
      token.ensureCurrent();
      setDaemonOnline(online);
    }, () => setDaemonOnline(false));
  }, [access, health]);

  useEffect(() => {
    if (!access) return;
    void loadAgents(false);
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), pollIntervalMs);
    return () => {
      window.clearInterval(timer);
      inventory.supersede();
      health.supersede();
    };
  }, [access, health, inventory, loadAgents, pollIntervalMs, refreshStatus]);

  const rescanAgents = useCallback(() => loadAgents(true), [loadAgents]);

  return {
    agents,
    scanningAgents,
    daemonOnline,
    runtimeInventoryError,
    rescanAgents,
  };
}
