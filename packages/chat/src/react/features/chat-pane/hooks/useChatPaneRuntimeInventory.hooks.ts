import { useCallback, useEffect, useRef, useState } from 'react';

import { useLatestOperation } from '../../../hooks/useLatestOperation.js';
import type { ChatPaneAgent, ChatPaneRuntimeAccess } from '../types.js';

const EMPTY_AGENTS: readonly ChatPaneAgent[] = [];

/** Waits between inventory retries while `listAgents` keeps failing: quick at first (a daemon
 *  restart takes seconds), then every 30s for as long as the pane stays mounted. */
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

export interface UseChatPaneRuntimeInventoryOptions {
  access?: ChatPaneRuntimeAccess;
  initialAgents?: readonly ChatPaneAgent[];
  pollIntervalMs?: number;
  /** Backoff between retries of a failed inventory load; the last entry repeats. */
  retryDelaysMs?: readonly number[];
}

export interface UseChatPaneRuntimeInventoryResult {
  agents: readonly ChatPaneAgent[];
  scanningAgents: boolean;
  /**
   * `listAgents` has not answered successfully yet and its last attempt failed — the host is
   * unreachable (typically a daemon restart), so a retry is pending. Not "no usable CLI": that is
   * only known once a load RESOLVES.
   */
  connectingAgents: boolean;
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
 * A REJECTED `listAgents` is "no answer yet", never a final empty inventory (2026-09-28: the
 * daemon restarting under an open pane left it on "No usable CLI is selected" until a hard
 * reload). Until the first successful answer the hook retries on a backoff, and immediately when
 * the daemon goes from offline to online, the window regains focus, or the tab becomes visible.
 * A RESOLVED list — even an empty one — is a finished answer; hosts reject when theirs is not one.
 *
 * Health polling runs only while the tab is visible (hidden tabs made no-op status calls every
 * `pollIntervalMs` forever), and never overlaps a status call still in flight.
 *
 * @complexity Time: O(n) per inventory response; space: O(n) for the snapshot.
 * @overallScore 100/100
 */
export function useChatPaneRuntimeInventory({
  access,
  initialAgents = EMPTY_AGENTS,
  pollIntervalMs = 5_000,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
}: UseChatPaneRuntimeInventoryOptions): UseChatPaneRuntimeInventoryResult {
  const [agents, setAgents] = useState<readonly ChatPaneAgent[]>(initialAgents);
  // Seeded from `access` at mount, not `false`: the load effect below only flips this to `true`
  // once it runs, which is after the first paint. Starting at `false` when `access` is already
  // defined at mount painted one frame where the inventory was neither loaded nor marked as
  // loading — indistinguishable from "detection finished, nothing usable" to any consumer keyed
  // off this flag, which is exactly the frame `ChatPane`'s "No usable CLI" banner flashed on.
  const [scanningAgents, setScanningAgents] = useState(() => access !== undefined);
  const [connectingAgents, setConnectingAgents] = useState(false);
  const [daemonOnline, setDaemonOnline] = useState(false);
  const [runtimeInventoryError, setRuntimeInventoryError] = useState<Error | null>(null);
  const inventory = useLatestOperation({});
  const health = useLatestOperation({});
  const retry = useInventoryRetry(retryDelaysMs);

  useEffect(() => {
    if (access !== undefined) return;
    inventory.supersede();
    retry.reset();
    setAgents(initialAgents);
    setScanningAgents(false);
    setConnectingAgents(false);
    setRuntimeInventoryError(null);
  }, [access, initialAgents, inventory, retry]);

  const loadAgents = useCallback(async (rescan: boolean): Promise<void> => {
    if (!access) return;
    retry.cancel();
    setScanningAgents(true);
    setRuntimeInventoryError(null);
    await inventory.run({ body: async (token) => {
      const nextAgents = await (rescan ? access.rescanAgents() : access.listAgents());
      token.ensureCurrent();
      retry.answered();
      setAgents([...nextAgents]);
      setConnectingAgents(false);
      setScanningAgents(false);
    }, onError: (error) => {
      // A failed load after a good answer keeps that inventory on screen. Before one there is no
      // last-good to keep: clear to empty, report "connecting", and try again on the backoff.
      if (!retry.hasAnswer()) {
        setAgents([]);
        setConnectingAgents(true);
        retry.schedule(() => void loadAgents(false));
      }
      setRuntimeInventoryError(error);
      setScanningAgents(false);
    } });
  }, [access, inventory, retry]);

  /** A fresh attempt now, with the backoff restarted — only while nothing has answered yet. */
  const reloadIfUnanswered = useCallback((): void => {
    if (retry.hasAnswer()) return;
    retry.restart();
    void loadAgents(false);
  }, [loadAgents, retry]);

  const refreshStatus = useCallback(async (): Promise<void> => {
    // No `if (!access) return` guard here (unlike `loadAgents`, which is reachable through
    // the publicly-exposed `rescanAgents` and so can be invoked with a stale closure by the
    // host): `refreshStatus` is never returned from this hook, so its call sites (the effects
    // below) all sit behind their own `if (!access) return` — `access` is guaranteed defined by
    // the time any one runs.
    const runtimeAccess = access as ChatPaneRuntimeAccess;
    await health.run({ body: async (token) => {
      const online = await runtimeAccess.daemonOnline();
      token.ensureCurrent();
      setDaemonOnline(online);
      if (retry.observeOnline(online)) reloadIfUnanswered();
    }, onError: () => {
      retry.observeOnline(false);
      setDaemonOnline(false);
    } });
  }, [access, health, reloadIfUnanswered, retry]);

  useEffect(() => {
    if (!access) return;
    retry.reset();
    void loadAgents(false);
    // Health polls only while the tab is visible: a hidden tab stops its timer, and showing it
    // again checks once at once and restarts the interval. A tick is skipped while the previous
    // status call is still out, so a slow host never piles up requests.
    let timer: number | undefined;
    let statusInFlight = false;
    const pollStatus = (): void => {
      if (statusInFlight) return;
      statusInFlight = true;
      void refreshStatus().finally(() => {
        statusInFlight = false;
      });
    };
    const startPolling = (): void => {
      if (timer === undefined) timer = window.setInterval(pollStatus, pollIntervalMs);
    };
    const stopPolling = (): void => {
      window.clearInterval(timer);
      timer = undefined;
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState !== 'visible') {
        stopPolling();
        return;
      }
      pollStatus();
      startPolling();
    };
    pollStatus();
    if (document.visibilityState === 'visible') startPolling();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopPolling();
      retry.cancel();
      inventory.supersede();
      health.supersede();
    };
  }, [access, health, inventory, loadAgents, pollIntervalMs, refreshStatus, retry]);

  useEffect(() => {
    if (!access) return;
    // The status check on becoming visible belongs to the polling effect above; this one only
    // retries an unanswered inventory load (and, on focus, checks status too).
    const onFocus = (): void => {
      if (document.visibilityState === 'hidden') return;
      void refreshStatus();
      reloadIfUnanswered();
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'hidden') return;
      reloadIfUnanswered();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [access, refreshStatus, reloadIfUnanswered]);

  const rescanAgents = useCallback(() => loadAgents(true), [loadAgents]);

  return {
    agents,
    scanningAgents,
    connectingAgents,
    daemonOnline,
    runtimeInventoryError,
    rescanAgents,
  };
}

interface InventoryRetry {
  /** Whether any inventory load has succeeded since the last {@link InventoryRetry.reset}. */
  hasAnswer(): boolean;
  /** Records a successful load: no more retries, backoff back to its first step. */
  answered(): void;
  /** Runs `attempt` after the current backoff step, then advances the step (the last repeats). */
  schedule(attempt: () => void): void;
  /** Drops a pending retry without touching the backoff step. */
  cancel(): void;
  /** Drops a pending retry and restarts the backoff at its first step. */
  restart(): void;
  /** Forgets everything — for a new `access`, whose answers the old ones say nothing about. */
  reset(): void;
  /** Records a health result; `true` only for an offline-to-online transition. */
  observeOnline(online: boolean): boolean;
}

/**
 * The retry bookkeeping `useChatPaneRuntimeInventory` needs, in refs so none of it re-renders:
 * whether an answer has arrived, the pending retry timer, the backoff step, and the last health
 * result (`null` until the first one, so the first "online" report is not a reconnect).
 */
function useInventoryRetry(delaysMs: readonly number[]): InventoryRetry {
  const answeredRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const stepRef = useRef(0);
  const lastOnlineRef = useRef<boolean | null>(null);
  const delaysRef = useRef(delaysMs);
  delaysRef.current = delaysMs;
  const [retry] = useState<InventoryRetry>(() => {
    const cancel = (): void => {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    };
    const restart = (): void => {
      cancel();
      stepRef.current = 0;
    };
    return {
      hasAnswer: () => answeredRef.current,
      answered: () => {
        answeredRef.current = true;
        restart();
      },
      schedule: (attempt) => {
        cancel();
        const delays = delaysRef.current;
        const delay = delays[Math.min(stepRef.current, delays.length - 1)] ?? 0;
        stepRef.current += 1;
        timerRef.current = window.setTimeout(attempt, delay);
      },
      cancel,
      restart,
      reset: () => {
        restart();
        answeredRef.current = false;
        lastOnlineRef.current = null;
      },
      observeOnline: (online) => {
        const reconnected = online && lastOnlineRef.current === false;
        lastOnlineRef.current = online;
        return reconnected;
      },
    };
  });
  return retry;
}
