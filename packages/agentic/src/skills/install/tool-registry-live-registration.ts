/**
 * @module tool-registry-live-registration
 *
 * Live skill registration on the core `ToolRegistry`: skill slots stay on the append-only registry
 * while their active registrations change. Removed slots deny both authorization and execution;
 * the registry identity remains intact.
 */
import type { ToolRegistration, ToolRegistry } from '@jini-ai/core';
import { createLiveSkillRegistration, type SkillRegistryPort } from './live-registration.js';

/**
 * Wraps `registry` so the returned `replace(tools)` swaps the active skill registrations in place.
 * @returns `replace`; it reports whether the active set changed.
 * @complexity O(n) per replacement, O(total distinct skill ids) retained slots.
 */
export function createLiveToolRegistration(
  { registry, inactiveError }: { registry: ToolRegistry; inactiveError: (required: { id: string }) => Error },
  _optional = {},
): (tools: readonly ToolRegistration[]) => boolean {
  type Frame = { authorization?: Parameters<ToolRegistration["policy"]["authorize"]>[0]; execution?: Parameters<ToolRegistration["handler"]>[0]; options?: Parameters<ToolRegistration["handler"]>[1] };
  const has = registry.has.bind(registry);
  const list = registry.list.bind(registry);
  const adapter: SkillRegistryPort<ToolRegistration["descriptor"], Frame> = {
    list: required => [...list(required)],
    has: ({ id }) => has({ toolId: id }),
    register: ({ tool }) => registry.register({ descriptor: tool.descriptor,
      policy: { authorize: context => tool.policy.authorize({ context: { authorization: context } }) as ReturnType<ToolRegistration["policy"]["authorize"]> },
      handler: (context, optional = {}) => tool.handler({ context: { execution: context, options: optional } }) as ReturnType<ToolRegistration["handler"]>,
    }),
  };
  const replace = createLiveSkillRegistration({ registry: adapter, inactiveError });
  registry.list = required => adapter.list(required);
  registry.has = ({ toolId }) => adapter.has({ id: toolId });
  return tools => replace({ tools: tools.map(tool => ({ descriptor: tool.descriptor,
    policy: { authorize: ({ context }) => {
      if (!context.authorization) throw new Error("Live skill tool has no authorization context");
      return tool.policy.authorize(context.authorization);
    } },
    handler: ({ context }) => {
      if (!context.execution) throw new Error("Live skill tool has no execution context");
      return tool.handler(context.execution, context.options);
    },
  })) });
}
