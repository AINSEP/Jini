import { Input } from './input.js';

/**
 * Uses `defaultValue` rather than `value` — an A2UI wire props snapshot has no guarantee a host
 * ever re-wires `onValueChange`, and a controlled `<input>` with no `onChange` is a React
 * anti-pattern (locks the field, warns in dev). `defaultValue` keeps typing usable even
 * unwired; a host that wires `onValueChange` still observes every keystroke via that callback,
 * same as `onRowClick` on `data-table` — it just doesn't force the DOM value back down.
 */
export interface TextInputFieldProps {
  readonly value?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly type?: 'text' | 'email' | 'password' | 'number';
  readonly onValueChange?: (value: string) => void;
}

export function TextInputField({ value, placeholder, disabled, type, onValueChange }: TextInputFieldProps) {
  return (
    <Input
      type={type ?? 'text'}
      defaultValue={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={onValueChange ? (event) => onValueChange(event.target.value) : undefined}
    />
  );
}
