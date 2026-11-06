import { agentHandleProps, agentHandleSegment } from '@jini-ai/agentic';
import { useAgentHandle, type AgentControlProps } from '../../../../react/hooks/useAgentHandle.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select.js';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

/** Host-wired `onValueChange`, not part of the agent-facing wire schema — see select-field.manifest.ts. */
export interface SelectFieldProps extends AgentControlProps {
  readonly portalContainer?: Element | DocumentFragment | null | undefined;
  readonly options: readonly SelectOption[];
  readonly value?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly onValueChange?: (value: string) => void;
}

export function SelectField({ options, value, placeholder, disabled, onValueChange, portalContainer, ...agentProps }: SelectFieldProps) {
  const base = useAgentHandle(agentProps);
  return (
    // Conditional spread for the same `exactOptionalPropertyTypes` reason as checkbox-field.tsx.
    <Select
      {...(value !== undefined ? { defaultValue: value } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
      {...(onValueChange ? { onValueChange } : {})}
    >
      <SelectTrigger {...agentHandleProps({}, { base, role: 'field' })} data-agent-private={agentProps['data-agent-private']}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent portalContainer={portalContainer}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}
            {...agentHandleProps({}, { base, action: `option-${agentHandleSegment({ value: option.value })}`, role: 'button', label: option.label })}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
