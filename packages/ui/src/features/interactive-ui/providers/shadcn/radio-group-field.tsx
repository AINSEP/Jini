import { useId } from 'react';
import { RadioGroup, RadioGroupItem } from './radio-group.js';
import { Label } from './label.js';

export interface RadioOption {
  readonly value: string;
  readonly label: string;
}

/** Host-wired `onValueChange`, not part of the agent-facing wire schema — see radio-group-field.manifest.ts. */
export interface RadioGroupFieldProps {
  readonly options: readonly RadioOption[];
  readonly value?: string;
  readonly disabled?: boolean;
  readonly onValueChange?: (value: string) => void;
}

export function RadioGroupField({ options, value, disabled, onValueChange }: RadioGroupFieldProps) {
  const groupId = useId();
  return (
    // Conditional spread for the same `exactOptionalPropertyTypes` reason as checkbox-field.tsx.
    <RadioGroup
      {...(value !== undefined ? { defaultValue: value } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
      {...(onValueChange ? { onValueChange } : {})}
    >
      {options.map((option) => {
        const itemId = `${groupId}-${option.value}`;
        return (
          <div key={option.value} className="flex items-center gap-2">
            <RadioGroupItem id={itemId} value={option.value} />
            <Label htmlFor={itemId}>{option.label}</Label>
          </div>
        );
      })}
    </RadioGroup>
  );
}
