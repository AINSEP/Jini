import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select.js';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

/** Host-wired `onValueChange`, not part of the agent-facing wire schema — see select-field.manifest.ts. */
export interface SelectFieldProps {
  readonly options: readonly SelectOption[];
  readonly value?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly onValueChange?: (value: string) => void;
}

export function SelectField({ options, value, placeholder, disabled, onValueChange }: SelectFieldProps) {
  return (
    // Conditional spread for the same `exactOptionalPropertyTypes` reason as checkbox-field.tsx.
    <Select
      {...(value !== undefined ? { defaultValue: value } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
      {...(onValueChange ? { onValueChange } : {})}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
