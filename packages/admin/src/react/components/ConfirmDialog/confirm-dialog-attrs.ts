import { agentHandle } from '@jini-ai/agentic';
import type { AgentAttrsPort, KitAttrs } from '@jini-ai/ui-kit';

/**
 * The agent-attribute port `ConfirmDialog` hands UI-kit's confirm controller. UI-kit names selects
 * separately; agentic publishes them as fields and still owns handle validation. Absent role/label
 * options stay absent rather than being sent as `undefined`.
 *
 * @complexity O(1).
 */
export const confirmDialogAgentAttrs: AgentAttrsPort = (required, optional = {}) => agentHandle(required, {
  ...(optional.role === undefined ? {} : { role: optional.role === 'select' ? 'field' : optional.role }),
  ...(optional.label === undefined ? {} : { label: optional.label }),
});

/**
 * Keep admin's concise accessible names; the shared planner still supplies consequence-aware agent
 * labels. Returns the action's attributes without UI-kit's `aria-label`. UI-kit's `ButtonProps`
 * types `attrs` as optional, so a missing set yields an empty one.
 *
 * @complexity O(k) in the number of attributes.
 */
export function withoutAccessibleName({ attrs }: { attrs: KitAttrs | undefined }, _optional: Record<string, never> = {}): KitAttrs {
  const { 'aria-label': _accessibleName, ...rest } = attrs ?? {};
  return rest;
}
