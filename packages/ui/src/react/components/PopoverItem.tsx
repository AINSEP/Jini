import type { ReactNode } from 'react';
import { agentHandleProps } from '@jini-ai/agentic';
import { useAgentHandle, type AgentControlProps } from '../hooks/useAgentHandle.js';

export interface PopoverItemProps extends AgentControlProps {
  selected?: boolean;
  /** Rendered when `selected` — typically a check icon. Omit for a plain
   *  text-only item with no selection affordance. */
  selectedIcon?: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  /** Native hover tooltip, surfaced when the visible label is truncated to
   *  ellipsis by CSS (e.g. a long option label in a narrow menu). Optional
   *  so unchanged call sites with short fixed labels don't grow a noisy
   *  duplicate tooltip. */
  title?: string;
}

/**
 * Generic single-select-style menu row: an optional selected-check slot,
 * a label, and an optional secondary hint line. Props in, JSX out.
 *
 * Origin: `PopoverItem` from the vendored schedule/mention god-component
 * (recon r6 §1.19) — generic, no product types.
 */
export function PopoverItem({ selected = false, selectedIcon, label, hint, onClick, title, ...agentProps }: PopoverItemProps) {
  const base = useAgentHandle(agentProps);
  return (
    <button
      {...agentHandleProps({}, { base, role: 'button', label })}
      data-agent-private={agentProps['data-agent-private']} data-agent-page={agentProps['data-agent-page']}
      type="button"
      className={`jini-popover__item${selected ? ' is-selected' : ''}`}
      onClick={onClick}
      title={title}
    >
      <span className="jini-popover__check">{selected ? selectedIcon : null}</span>
      <span className="jini-popover__body">
        <span className="jini-popover__label">{label}</span>
        {hint ? <span className="jini-popover__hint">{hint}</span> : null}
      </span>
    </button>
  );
}
