/** Assistant adapter over the screen's dispatcher and admitted handler host. No module is reloaded here. */
import type { AdminSurfaceActionOutcome } from './protocol.js';
import { ToolInputError, requireInputRecord } from '@jini-ai/core';
import type { AgentPluginAdditionalTool, AgentPluginToolInvocation } from '../lifecycle/tools/projection.js';
import { createAdminSurfaceActionDispatcher, type AdminSurfaceActionHandler } from './action-dispatcher.js';
import { exceedsAdminSurfacePayloadLimit, validateAdminSurfaceActionValue } from './action-schema.js';
import type { AdminSurfaceAction, AdminSurfaceDescriptor } from './descriptor.js';
import type { AdminSurfaceHandlerContext } from './surface-handlers.js';

/** Admin tools always act for an authenticated principal, supplied by the registry. */
export interface AdminSurfaceToolContext extends AdminSurfaceHandlerContext {
  readonly principalId: string;
}

/** The host binds this from active, trusted surface contributions and its existing handler host. */
export interface AdminSurfaceToolSource {
  readonly pluginId: string;
  readonly descriptor: AdminSurfaceDescriptor;
}

/** Checks the tool envelope and delegates payload validation to the screen's schema owner.
 * @throws ToolInputError without echoing input values. @complexity O(p) payload size. */
function checkedPayload(required: { readonly input: unknown; readonly action: AdminSurfaceAction }, _optional: Record<string, never> = {}): unknown {
  const { input, action } = required;
  const record = requireInputRecord({ input });
  if (Object.keys(record).length !== 1 || !Object.hasOwn(record, 'payload') || exceedsAdminSurfacePayloadLimit({ payload: record.payload })
    || validateAdminSurfaceActionValue({ schema: action.input, value: record.payload }) !== null) {
    throw new ToolInputError({ message: 'Supply payload matching the declared admin action schema.' });
  }
  return record.payload;
}

/**
 * Projects every declared surface action into the existing plugin-tool contract. All actions use a
 * `payload` envelope (including scalar/array actions), and the SAME dispatcher and handler host as
 * the screen. The host supplies fresh authorization/admission before each call, including after a
 * confirmation wait. Browser flows return their result and any host-issued URLs; this seam cannot open a browser.
 * @param required.authorize - Must enforce the screen action permission and fresh trusted admission.
 * @param optional.run - Request-local result decoration, e.g. collecting host-issued sign-in URLs.
 * @returns Contributions for `createAgentPluginToolProjection.sync({ additionalTools })`.
 * @complexity O(s + a) surfaces and actions, bounded by the descriptor parser; dispatch O(p) + handler.
 */
export function buildAdminSurfaceActionTools(required: {
  readonly surfaces: readonly AdminSurfaceToolSource[];
  readonly handlersFor: (input: { readonly pluginId: string; readonly surfaceId: string }) => Readonly<Record<string, AdminSurfaceActionHandler<AdminSurfaceToolContext>>>;
  readonly authorize: (input: { readonly context: AdminSurfaceToolContext }) => Promise<void>;
}, optional: { readonly run?: (input: { readonly dispatch: () => Promise<AdminSurfaceActionOutcome> }) => Promise<unknown> } = {}): readonly AgentPluginAdditionalTool[] {
  return required.surfaces.flatMap(({ pluginId, descriptor }) => descriptor.actions.map((action): AgentPluginAdditionalTool => {
    const name = `${descriptor.id.replace(/-/g, '_')}_${action.name.replace(/-/g, '_')}`;
    return {
      pluginId,
      tool: {
        name, description: `${descriptor.title}: ${action.name}. Browser sign-in actions return a URL to show the user.`,
        effect: action.effect ?? 'write',
        inputSchema: { type: 'object', properties: { payload: action.input }, required: ['payload'], additionalProperties: false },
        async handler({ auth, input }: AgentPluginToolInvocation) {
          if (!auth.principalId) throw new ToolInputError({ message: 'Admin actions require an authenticated principal.' });
          const context: AdminSurfaceToolContext = { ...auth, principalId: auth.principalId, pluginId, surfaceId: descriptor.id };
          await required.authorize({ context });
          const payload = checkedPayload({ input, action });
          const dispatcher = createAdminSurfaceActionDispatcher({ descriptor, handlers: required.handlersFor({ pluginId, surfaceId: descriptor.id }) });
          const dispatch = () => dispatcher.dispatch({ action: action.name, payload, context });
          return optional.run ? optional.run({ dispatch }) : dispatch();
        },
      },
      describeAffectedResources({ input }) {
        checkedPayload({ input, action });
        return [`${descriptor.title}: ${action.name}`];
      },
    };
  }));
}
