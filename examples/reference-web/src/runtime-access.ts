import { FETCH_TIMEOUT_MS, fetchWithTimeout } from '@jini-ai/platform/fetch-with-timeout';
import type { ChatPaneAgent, ChatPaneRuntimeAccess } from '@jini-ai/chat/react';

async function readAgents(response: Response): Promise<readonly ChatPaneAgent[]> {
  if (!response.ok) throw new Error('Agent inventory is unavailable');
  const body = (await response.json()) as { agents?: ChatPaneAgent[] };
  return body.agents ?? [];
}

/** Reference-host HTTP effects consumed by the package-owned runtime hook. */
export const PLAYGROUND_RUNTIME_ACCESS: ChatPaneRuntimeAccess = {
  async listAgents() {
    return readAgents(await fetchWithTimeout('/api/agents', {}, { timeoutMs: FETCH_TIMEOUT_MS.QUICK }));
  },
  async rescanAgents() {
    return readAgents(
      await fetchWithTimeout('/api/agents/rescan', { method: 'POST' }, { timeoutMs: FETCH_TIMEOUT_MS.QUICK }),
    );
  },
  async daemonOnline() {
    const response = await fetchWithTimeout('/api/daemon/status', {}, { timeoutMs: FETCH_TIMEOUT_MS.QUICK });
    if (!response.ok) return false;
    return ((await response.json()) as { ok?: boolean }).ok === true;
  },
};
