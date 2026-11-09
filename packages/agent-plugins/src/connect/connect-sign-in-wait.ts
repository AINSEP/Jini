import type { SurfaceCardSecretDeps } from '@jini-ai/core/contracts/cards';
import { type ToolExecutionContext, type ToolExecutionOptions } from '@jini-ai/core';
import type { PluginCredentialCard } from '@jini-ai/core/contracts/credentials';
import type { AgentPluginCardsPort, AgentPluginConnectCardSpec } from './connect-card-ui.js';

/** The plugin's MCP and API sign-ins share one card/exchange lifecycle. Skip cancels only the
 * sign-in watcher; the enclosing agent run continues. OAuth callback/token custody stays with
 * each connection owner. @complexity One bounded connection wait and one exchange per sign-in. */
/* `Result` is the connect tool's result (`AgentPluginConnectResult`); it is a type parameter here so the
 * connect-tool <-> sign-in-wait type cycle needs no import back (the waiter only passes it through). */
export async function waitAtAgentPluginSignInCardWithPorts<Resource, Result extends { status: string }>(required: {
  surfaceExchanges: SurfaceCardSecretDeps['surfaceExchanges']; cards: AgentPluginCardsPort<Resource>;
  buildCard: (spec: AgentPluginConnectCardSpec) => Resource; toolId: string; missingEmitterMessage: string; skippedResult: () => Result; ctx: ToolExecutionContext; pluginId: string; pluginDisplayName: string;
  credentialCard?: PluginCredentialCard;
  connect: (input: { signal: AbortSignal; showSignIn: (input: { signInUrl: string }) => Promise<void> }) => Promise<Result>;
}, optional: ToolExecutionOptions = {}): Promise<Result> {
  const { cards, ctx, pluginId, pluginDisplayName, credentialCard, connect } = required;
  return cards.waitAtSignInCard<Result>({
    surfaceExchanges: required.surfaceExchanges, ctx, toolId: required.toolId, connect,
    card: state => required.buildCard(state.state === 'waiting'
      ? { pluginId, pluginDisplayName, credentialCard, ...state }
      : { pluginId, pluginDisplayName, ...state }),
    missingEmitterMessage: required.missingEmitterMessage,
    skippedResult: required.skippedResult,
  }, optional);
}
