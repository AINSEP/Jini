import { useEffect, useMemo, useRef, useState } from "react";

/** Structural slice of the host's execution port: the two local-agent detection calls. */
export interface AuthDetectionPort<TAgent> {
  detectLocalAgents(): Promise<readonly TAgent[]>;
  rescanLocalAgents?(): Promise<readonly TAgent[]>;
}

/** Structural slice of the chat pane's runtime access: only its Rescan is wrapped. */
export interface RescannableRuntimeAccess {
  rescanAgents(): Promise<unknown>;
}

/**
 * D-21(b): the dock's half of the Settings "AI agent" sign-in warning.
 *
 * The picker's own `/api/agents` inventory carries no authentication status, so this reads the same
 * detection Settings renders (the host's `createPort` — its module-cached sweep, no extra process scan on
 * mount) and hands it to the already-tested `selectWarning`, which only warns on a CONFIRMED
 * missing sign-in, never on unknown, and never in BYOK mode.
 *
 * The returned `runtimeAccess` wraps the picker's Rescan so a sign-in done mid-session clears the
 * warning: the picker's own answer is returned untouched and unblocked, and the auth re-probe runs
 * beside it. A failed detection leaves no warning rather than inventing one.
 *
 * @param input.mode The persisted execution mode (`"local-cli"` | `"byok"`).
 * @param input.agentId The picker's selected agent; `useLocalCliSelection` already defaults it to Claude.
 * @param input.locale Admin locale for the warning copy.
 * @param input.runtimeAccess The picker's runtime access to wrap.
 * @param input.createPort The host's shared Settings detection port factory; called once, on mount.
 * @param input.selectWarning The host's Settings warning rule over the detected agents.
 * @param options.port Detection port; defaults to the one `createPort` builds.
 * @returns `{ warning, runtimeAccess }` — `warning` is null when nothing needs attention.
 * @complexity O(n) over the detected agents per settled scan.
 */
export function useSelectedAgentAuthWarning<TAgent, TAccess extends RescannableRuntimeAccess>(
  { mode, agentId, locale, runtimeAccess, createPort, selectWarning }: {
    mode: string; agentId: string | null | undefined; locale: string; runtimeAccess: TAccess;
    createPort: () => AuthDetectionPort<TAgent>;
    selectWarning: (input: { mode: string; agentId: string | null; agents: readonly TAgent[]; locale: string }) => string | null;
  },
  { port: injectedPort }: { port?: AuthDetectionPort<TAgent> } = {},
) {
  const [port] = useState<AuthDetectionPort<TAgent>>(() => injectedPort ?? createPort());
  const [agents, setAgents] = useState<readonly TAgent[]>([]);
  const generation = useRef(0);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  const scanRef = useRef((request: () => Promise<readonly TAgent[]>) => {
    generation.current += 1;
    const scan = generation.current;
    // Through a promise so a port that throws synchronously still lands in the no-warning branch.
    Promise.resolve().then(request).then(
      // A slow first detection must not overwrite a newer rescan's result.
      (next) => { if (live.current && scan === generation.current) setAgents(next); },
      () => { if (live.current && scan === generation.current) setAgents([]); },
    );
  });

  // Re-read on mode/agent change: cheap (module-cached), and Settings may have rescanned meanwhile.
  useEffect(() => {
    if (mode === "local-cli") scanRef.current(() => port.detectLocalAgents());
  }, [mode, agentId, port]);

  const wrappedAccess = useMemo<TAccess>(() => ({
    ...runtimeAccess,
    rescanAgents: () => {
      scanRef.current(() => port.rescanLocalAgents ? port.rescanLocalAgents() : port.detectLocalAgents());
      return runtimeAccess.rescanAgents();
    },
  }), [runtimeAccess, port]);

  return {
    warning: selectWarning({ mode, agentId: agentId ?? "claude", agents, locale }),
    runtimeAccess: wrappedAccess,
  };
}
