import { useId } from 'react';
import { Checkbox } from './checkbox.js';
import { Label } from './label.js';

/** Host-wired `onCheckedChange`, not part of the agent-facing wire schema — see checkbox-field.manifest.ts. */
export interface CheckboxFieldProps {
  readonly label?: string;
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly onCheckedChange?: (checked: boolean) => void;
}

export function CheckboxField({ label, checked, disabled, onCheckedChange }: CheckboxFieldProps) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      {/* Radix's own prop types are exact-optional (no explicit `| undefined`), so an omitted
          wire prop must not appear on this element at all — conditional spread instead of
          passing `checked={undefined}`. */}
      <Checkbox
        id={id}
        {...(checked !== undefined ? { checked } : {})}
        {...(disabled !== undefined ? { disabled } : {})}
        {...(onCheckedChange ? { onCheckedChange: (state: boolean | 'indeterminate') => onCheckedChange(state === true) } : {})}
      />
      {label ? <Label htmlFor={id}>{label}</Label> : null}
    </div>
  );
}
