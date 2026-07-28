import type { ChatPaneAgent, ChatPaneRuntimeAccess } from '@jini-ai/chat-react';

async function readAgents(response: Response): Promise<readonly ChatPaneAgent[]> {
  if (!response.ok) throw new Error('Agent inventory is unavailable');
  const body = (await response.json()) as { agents?: ChatPaneAgent[] };
  return body.agents ?? [];
}

/** Reference-host HTTP effects consumed by the package-owned runtime hook. */
export const PLAYGROUND_RUNTIME_ACCESS: ChatPaneRuntimeAccess = {
  async listAgents() {
    return readAgents(await fetch('/api/agents'));
  },
  async rescanAgents() {
    return readAgents(await fetch('/api/agents/rescan', { method: 'POST' }));
  },
  async daemonOnline() {
    const response = await fetch('/api/daemon/status');
    if (!response.ok) return false;
    return ((await response.json()) as { ok?: boolean }).ok === true;
  },
};
