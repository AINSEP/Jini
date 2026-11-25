import type { ExecutionPort, ExecutionCardAgent } from '@jini-ai/core/contracts/execution';

/** Detection runs on the server; preload bridge presence identifies when that server is local.
 * Returns the dictionary KEY: the server-scope one carries `{productName}`, filled at each render site
 * from `SETTINGS_EXECUTION_PRODUCT_VARS` (`integrations/jini-admin/settings-execution-copy.ts`).
 * Do not infer desktop from screen size, localhost URLs, or the site-switcher flag. */
export function localCliScopeCopy(
  { desktop, desktopKey, serverKey }: { desktop: boolean; desktopKey: string; serverKey: string }, _optional = {},
): string {
  return desktop ? desktopKey : serverKey;
}

/** Unknown authentication is not a refusal. Warn only about a confirmed missing sign-in. */
export function selectedAgentWarning(
  { mode, agentId, agents, locale, translate }: {
    mode: string; agentId: string | null; agents: readonly ExecutionCardAgent[]; locale: string;
    translate: (required: { locale: string; key: string }) => string;
  }, _optional = {},
): string | null {
  const agent = agents.find((candidate) => candidate.id === agentId);
  return mode === 'local-cli' && agent?.installed && agent.authStatus === 'missing'
    ? `${agent.label}: ${translate({ locale: locale, key: 'Authentication required. Sign in before sending.' })}` : null;
}

/** Empty strings suppress the shared card's divider; trim whitespace without inventing vendor copy.
 * Undefined preserves Jini's existing vendor-description fallback. */
export function normalizeAgentDescription(
  { agent }: { agent: ExecutionCardAgent }, _optional = {},
): ExecutionCardAgent {
  return agent.description === undefined ? agent : { ...agent, description: agent.description.trim() };
}

/** Share the component's scan with the warning instead of spawning another inventory sweep.
 * Rescan results replace previous auth status; rejected scans remain failures, never empty lists. */
export function createAgentPresentationPort(
  { port, onAgents }: { port: ExecutionPort; onAgents: (input: { agents: readonly ExecutionCardAgent[] }, options?: Record<string, never>) => void },
  _optional = {},
): ExecutionPort {
  let latestScan = 0;
  const project = async ({ request }: { request: () => Promise<readonly ExecutionCardAgent[]> }, _options = {}) => {
    latestScan += 1;
    const scan = latestScan;
    const agents = (await request()).map((agent) => normalizeAgentDescription({ agent }));
    // A slow initial scan must not overwrite a newer rescan's authentication result.
    if (scan === latestScan) onAgents({ agents });
    return agents;
  };
  const rescanLocalAgents = port.rescanLocalAgents;
  return {
    ...port,
    detectLocalAgents: () => project({ request: () => port.detectLocalAgents() }),
    ...(rescanLocalAgents ? { rescanLocalAgents: () => project({ request: () => rescanLocalAgents.call(port) }) } : {}),
  };
}
