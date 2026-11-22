import { fetchWithTimeout } from '@jini-ai/platform/fetch-with-timeout';
import { FETCH_TIMEOUT_MS } from '@jini-ai/core/net';
import type { ChatPaneAgent, ChatPaneRuntimeAccess } from '@jini-ai/chat/react';

async function readAgents(response: Response): Promise<readonly ChatPaneAgent[]> {
  if (!response.ok) throw new Error('Agent inventory is unavailable');
  const body = (await response.json()) as { agents?: ChatPaneAgent[] };
  return body.agents ?? [];
}

/** Reference-host HTTP effects consumed by the package-owned runtime hook. */
export const PLAYGROUND_RUNTIME_ACCESS: ChatPaneRuntimeAccess = {
  async listAgents() {
    return readAgents(await fetchWithTimeout({ url: '/api/agents', timeoutMs: FETCH_TIMEOUT_MS.QUICK }, { init: {} }));
  },
  async rescanAgents() {
    return readAgents(
      await fetchWithTimeout({ url: '/api/agents/rescan', timeoutMs: FETCH_TIMEOUT_MS.QUICK }, { init: { method: 'POST' } }),
    );
  },
  async daemonOnline() {
    const response = await fetchWithTimeout({ url: '/api/daemon/status', timeoutMs: FETCH_TIMEOUT_MS.QUICK }, { init: {} });
    if (!response.ok) return false;
    return ((await response.json()) as { ok?: boolean }).ok === true;
  },
};
