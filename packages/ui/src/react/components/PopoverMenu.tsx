import type { ReactNode } from 'react';
import { agentHandleProps } from '@jini-ai/agentic';
import type { AgentControlProps } from '../hooks/useAgentHandle.js';
import { withClassName } from '../../utils/class-names.js';

export interface PopoverMenuProps extends AgentControlProps {
  children?: ReactNode;
  className?: string;
}

/**
 * Generic popover panel shell: a plain positioned wrapper around a list of
 * `PopoverItem`s (or any other content). No open/closed state of its own —
 * the caller decides when to render it (see {@link PillButton}).
 *
 * Origin: `PopoverMenu` from the vendored schedule/mention god-component
 * (recon r6 §1.19) — generic, no product types.
 */
export function PopoverMenu({ children, className, ...agentProps }: PopoverMenuProps) {
  const base = agentProps.agentHandle === false || agentProps['data-agent-private'] !== undefined
    ? undefined : agentProps.agentHandle ?? agentProps['data-agent-element'];
  return <div {...agentHandleProps({}, { base, role: 'region' })} data-agent-private={agentProps['data-agent-private']} data-agent-page={agentProps['data-agent-page']} className={withClassName('jini-popover', className)}>{children}</div>;
}
