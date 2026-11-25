import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExecutionCardAgent, ExecutionConfig, ExecutionPort } from '@jini-ai/core/contracts/execution';
import { createAgentPresentationPort, localCliScopeCopy, selectedAgentWarning } from '../ai-agent-presentation.js';

/** Observe the same detection that renders Settings cards, including rescans and selection changes. */
export function useAiAgentPresentation(
  { port, config, locale, desktop, defaultLocalAgentId, translate, scopeKeys }: {
    port: ExecutionPort; config: ExecutionConfig | null; locale: string; desktop: boolean; defaultLocalAgentId: string;
    translate: (required: { locale: string; key: string }) => string;
    scopeKeys: { desktopKey: string; serverKey: string };
  },
  _optional: Record<string, never> = {},
) {
  const [agents, setAgents] = useState<readonly ExecutionCardAgent[]>([]);
  const live = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  const presentationPort = useMemo(() => createAgentPresentationPort({
    port,
    // Detection can finish after navigating away; no state should be written to an unmounted tab.
    onAgents: ({ agents: next }, _options = {}) => { if (live.current) setAgents((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next); },
  }), [port]);
  return {
    port: presentationPort,
    scopeCopy: localCliScopeCopy({ desktop, ...scopeKeys }),
    // The dock's useLocalCliSelection defaults an unset ledger selection to Claude. Warn about
    // that same effective choice here, including a fresh desktop install with no saved agent id.
    warning: selectedAgentWarning({ mode: config?.mode ?? '', agentId: config?.localCli.agentId ?? defaultLocalAgentId, agents, locale, translate }),
  };
}
