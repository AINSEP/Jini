import { useId } from 'react';
import { agentHandleSegment } from '@jini-ai/agentic';

/** Shared controls preserve explicit names; `false` suppresses automatic addressing. */
export interface AgentControlProps {
  readonly agentHandle?: string | false | undefined;
  readonly 'data-agent-element'?: string | undefined;
  readonly 'data-agent-private'?: string | boolean | undefined;
  readonly 'data-agent-page'?: string | undefined;
}

/**
 * Resolves a mounted control's stable address without using labels or list positions.
 * React instance identity distinguishes roots and survives rerenders/keyed reordering;
 * remounts may receive a new address. Semantic privacy and opt-out take precedence.
 * @param required - Explicit handle/markup or opt-out; private controls never get a handle.
 * @returns The supplied name, a bounded automatic name, or undefined when excluded.
 * @complexity O(n) in the React instance id; no I/O or DOM effects.
 */
export function useAgentHandle(required: AgentControlProps, _optional: Record<string, never> = {}): string | undefined {
  const id = useId();
  if (required.agentHandle === false || required['data-agent-private'] !== undefined) return undefined;
  return required.agentHandle ?? required['data-agent-element'] ?? `ui-${agentHandleSegment({ value: id })}`;
}
