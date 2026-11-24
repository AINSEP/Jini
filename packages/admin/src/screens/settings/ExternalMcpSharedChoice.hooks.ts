import { useState } from 'react';
import { describeApiError } from '@jini-ai/core/admin-runtime';

/**
 * @file The saved-connection chooser's controller. What it needs from the outside world is the
 * {@link ExternalMcpSharedChoicePort} on its own args, not a host request client: the host builds the
 * live port with its own integrations client and binds it into the hook it passes to
 * `ExternalMcpSharedChoice` as the required `useExternalMcpSharedChoiceHook` prop.
 *
 * A port rejection must be an `AdminApiError` (`@jini-ai/core/admin-runtime`) for its own message to
 * reach the operator; any other thrown value shows the action's fallback copy (core's
 * `describeApiError`), because a non-API exception is not approved copy.
 */

/** The owner-saved MCP connections the host reports for one server. */
export interface SharedView {
  available: boolean;
  connections: { credentialId: string; label: string }[];
  current: { credentialId: string; status: string; granted: boolean } | null;
}

/** The host's `/mcp-servers/:id/oauth/shared` operations, as this chooser calls them. Every method
 *  rejects with an `AdminApiError` on an API failure. */
export interface ExternalMcpSharedChoicePort {
  listSharedMcpConnections(required: { serverId: string }, optional?: Record<string, never>): Promise<SharedView>;
  useSharedMcpConnection(required: { serverId: string; credentialId: string }): Promise<unknown>;
  stopSharedMcpConnection(required: { serverId: string }, optional?: Record<string, never>): Promise<unknown>;
  useLocalMcpConnection(required: { serverId: string }, optional?: Record<string, never>): Promise<unknown>;
}

export interface ExternalMcpSharedChoiceController {
  view: SharedView | undefined; error: string; pending: boolean;
  load: () => Promise<void>;
  chooseSaved: (required: { credentialId: string }, optional?: Record<string, never>) => Promise<void>;
  stopHere: () => Promise<void>;
  chooseLocal: () => Promise<void>;
}

/** The hook shape `ExternalMcpSharedChoice` calls — the host binds its port into it. */
export type UseExternalMcpSharedChoice = (required: { serverId: string; onChanged: () => void }) => ExternalMcpSharedChoiceController;

/** Load and select owner-saved MCP connections for this server. */
export function useExternalMcpSharedChoice({ serverId, onChanged, port }: { serverId: string; onChanged: () => void; port: ExternalMcpSharedChoicePort }, _options = {}): ExternalMcpSharedChoiceController {
  const [view, setView] = useState<SharedView>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function load() {
    setPending(true); setError('');
    try { setView(await port.listSharedMcpConnections({ serverId })); }
    catch (cause) { setError(describeApiError({ e: cause, fallback: 'Saved connections could not be opened. Try opening them again.' })); }
    finally { setPending(false); }
  }
  async function chooseSaved({ credentialId }: { credentialId: string }, _options = {}) {
    if (!credentialId) return;
    setPending(true); setError('');
    try { await port.useSharedMcpConnection({ serverId, credentialId }); await load(); onChanged(); }
    catch (cause) { setError(describeApiError({ e: cause, fallback: 'This saved connection could not be granted to this server. Choose another connection or sign in.' })); }
    finally { setPending(false); }
  }
  async function stopHere() {
    setPending(true); setError('');
    try { await port.stopSharedMcpConnection({ serverId }); await load(); onChanged(); }
    catch (cause) { setError(describeApiError({ e: cause, fallback: 'The connection could not be stopped here. Try again.' })); }
    finally { setPending(false); }
  }
  async function chooseLocal() {
    setPending(true); setError('');
    try { await port.useLocalMcpConnection({ serverId }); await load(); onChanged(); }
    catch (cause) { setError(describeApiError({ e: cause, fallback: 'The local connection could not be selected. Try again.' })); }
    finally { setPending(false); }
  }
  return { view, error, pending, load, chooseSaved, stopHere, chooseLocal };
}
