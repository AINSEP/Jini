import { useId } from 'react';
import { agentHandleProps } from '@jini-ai/agentic';
import { useAgentHandle, type AgentControlProps } from '../../../../react/hooks/useAgentHandle.js';
import { Checkbox } from './checkbox.js';
import { Label } from './label.js';

/** Host-wired `onCheckedChange`, not part of the agent-facing wire schema — see checkbox-field.manifest.ts. */
export interface CheckboxFieldProps extends AgentControlProps {
  readonly label?: string;
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly onCheckedChange?: (checked: boolean) => void;
}

export function CheckboxField({ label, checked, disabled, onCheckedChange, ...agentProps }: CheckboxFieldProps) {
  const id = useId();
  const base = useAgentHandle(agentProps);
  return (
    <div className="flex items-center gap-2">
      {/* Radix's own prop types are exact-optional (no explicit `| undefined`), so an omitted
          wire prop must not appear on this element at all — conditional spread instead of
          passing `checked={undefined}`. */}
      <Checkbox
        id={id}
        {...agentHandleProps({}, { base, role: 'field', ...(label === undefined ? {} : { label }) })}
        data-agent-private={agentProps['data-agent-private']} data-agent-page={agentProps['data-agent-page']}
        {...(checked !== undefined ? { checked } : {})}
        {...(disabled !== undefined ? { disabled } : {})}
        {...(onCheckedChange ? { onCheckedChange: (state: boolean | 'indeterminate') => onCheckedChange(state === true) } : {})}
      />
      {label ? <Label htmlFor={id}>{label}</Label> : null}
    </div>
  );
}
