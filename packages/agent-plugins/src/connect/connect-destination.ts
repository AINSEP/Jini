import { ToolInputError, SURFACE_DISMISSED_PARAM, SURFACE_EXCHANGE_ID_PARAM, type ToolExecutionContext, type ToolExecutionOptions } from '@jini-ai/core';
import type { SurfaceAnswerChannel, SurfaceAskThenReport, SurfaceExchangeStore } from '@jini-ai/core';
import type { AgentPluginCardBuilders } from './connect-card-ui.js';

/** Host wording and delivery channel for the destination card.
 * @agent-note Second host: `channel` is the channel your card runtime answers on (the same one the
 * callback route delivers to); the copy names where a shared connection lives on YOUR host. The
 * answer still accepts only `site`/`shared` from the current human exchange. */
export interface AgentPluginDestinationCardHost {
  readonly channel: SurfaceAnswerChannel;
  readonly messages: { readonly description: string; readonly sharedOptionLabel: string };
}

type Destination = 'site' | 'shared';

/** Only the current human exchange can select the shared destination. */
function selectedDestination(params: Record<string, unknown>): Destination {
  if (Object.keys(params).some(key => !['destination', SURFACE_EXCHANGE_ID_PARAM].includes(key))
    || (params.destination !== 'site' && params.destination !== 'shared')) {
    throw new ToolInputError({ message: 'Choose where to save this connection in its sign-in card. No site identity or credential can be submitted.' });
  }
  return params.destination as Destination;
}

/** Ask before sign-in, so a shared credential is issued directly into owner storage.
 * The host supplies availability only for the installation owner; cancellation starts no flow.
 * @returns Explicit destination, or null on cancellation/expiry/abort.
 * @complexity O(1), one bounded principal-bound human exchange; no storage or provider I/O.
 */
export async function chooseApiConnectionDestinationWithPorts<Resource>(required: {
  readonly cards: AgentPluginCardBuilders<Resource>; readonly askThenReport: SurfaceAskThenReport; readonly uriNamespace: string; readonly toolId: string;
  readonly host: AgentPluginDestinationCardHost;
  readonly surfaces: { readonly surfaceExchanges: SurfaceExchangeStore }; readonly ctx: ToolExecutionContext;
  readonly pluginDisplayName: string; readonly available: boolean;
}, optional: ToolExecutionOptions = {}): Promise<Destination | null> {
  if (!required.available) return 'site';
  if (!optional.emitSurface) throw new ToolInputError({ message: 'Choosing where to save a connection requires the interactive sign-in card. Open this action in chat.' });
  const { ctx, host } = required;
  ctx.signal.throwIfAborted();
  const exchange = required.surfaces.surfaceExchanges.open({ binding: { toolId: required.toolId, principalId: ctx.principal.id, channel: host.channel }, emit: optional.emitSurface });
  const close = () => exchange.close({});
  ctx.signal.addEventListener('abort', close, { once: true });
  try {
    return await required.askThenReport<Destination | null>({ exchange,
      confirmationEmission: { channel: host.channel, payload: { resource: required.cards.buildFormSurface({
        uri: `ui://${required.uriNamespace}/${exchange.id}`, title: `Connect ${required.pluginDisplayName}`,
        description: host.messages.description,
        fields: [{ kind: 'enum', name: 'destination', label: 'Save this connection', required: true, options: [
          { value: 'site', label: 'Use only on this site' }, { value: 'shared', label: host.messages.sharedOptionLabel },
        ] }], submitLabel: 'Continue to sign in', toolName: required.toolId, preferredFrameSize: ['100%', '1px'],
        baseParams: { [SURFACE_EXCHANGE_ID_PARAM]: exchange.id },
        cancel: { label: 'Cancel', toolName: required.toolId, params: { [SURFACE_EXCHANGE_ID_PARAM]: exchange.id, [SURFACE_DISMISSED_PARAM]: true } },
      }) } },
      handle: async answer => ({ result: answer.status !== 'received' || answer.params[SURFACE_DISMISSED_PARAM] === true || ctx.signal.aborted
        ? null : selectedDestination(answer.params) }),
    });
  } finally { ctx.signal.removeEventListener('abort', close); exchange.close({}); }
}
