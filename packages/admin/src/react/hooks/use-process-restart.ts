import { useEffect, useRef, useState } from 'react';

export interface ProcessRestartPort {
  restart(): Promise<{ ok: boolean; reason?: string }>;
  getStatus(): Promise<{ failed: boolean }>;
}

type RestartRequirements = {
  port: ProcessRestartPort;
  describeError: (required: { error: unknown; fallback: string }, optional?: Record<string, never>) => string;
  messages: { restartFallback: string; statusFallback: string };
};

export interface ProcessRestartController {
  restarting: boolean;
  /** The server's own answer to the last restart attempt; null before the first attempt. */
  restartResult: { ok: boolean; reason?: string } | null;
  /** Unexpected mutation failures only; ordinary refusals remain in restartResult. */
  restartError: string | null;
  checkingStatus: boolean;
  /** False means no failure is latched, never a claim of health; null means not yet checked. */
  knownFailed: boolean | null;
  statusError: string | null;
  restart(): Promise<void>;
  checkStatus(): Promise<void>;
}

function useProcessStatus({ port, describeError, messages }: RestartRequirements) {
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [knownFailed, setKnownFailed] = useState<boolean | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  async function checkStatus() {
    setCheckingStatus(true);
    setStatusError(null);
    try {
      const status = await port.getStatus();
      setKnownFailed(status.failed);
    } catch (error) {
      setStatusError(describeError({ error, fallback: messages.statusFallback }));
    } finally {
      setCheckingStatus(false);
    }
  }
  const initialCheckStatus = useRef(checkStatus);
  useEffect(() => {
    void initialCheckStatus.current();
  }, []);
  return { checkingStatus, knownFailed, statusError, checkStatus };
}

/**
 * Keeps mutation and status outcomes separate. Reads status once on mount and once after each
 * restart, never in a poll loop: initiating a restart supplies no health signal. Manual checks
 * remain immediate; the host may delay the automatic follow-up to avoid reading the old state.
 */
export function useProcessRestart(
  required: RestartRequirements,
  { postRestartCheckDelayMs = 0 }: { postRestartCheckDelayMs?: number } = {},
): ProcessRestartController {
  const { port, describeError, messages } = required;
  const [restarting, setRestarting] = useState(false);
  const [restartResult, setRestartResult] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [restartError, setRestartError] = useState<string | null>(null);
  const status = useProcessStatus(required);
  async function restart() {
    setRestarting(true);
    setRestartError(null);
    try {
      const result = await port.restart();
      setRestartResult(result);
    } catch (error) {
      setRestartError(describeError({ error, fallback: messages.restartFallback }));
    } finally {
      setRestarting(false);
    }
    // A failed re-check must never overwrite the mutation's answer. The mutation is already
    // settled throughout this delay; the follow-up read is outside its in-flight state.
    if (postRestartCheckDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, postRestartCheckDelayMs));
    }
    void status.checkStatus();
  }
  return { restarting, restartResult, restartError, ...status, restart };
}
