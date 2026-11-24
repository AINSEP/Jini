import type { SecurityChipFieldProps } from '../components/chip-field.js';
/** A stand-in for the host's chip field (the host binds its own at cutover): one checkbox per option. */
export function TestChipField({ label, options, value, onChange }: SecurityChipFieldProps) {
  return <fieldset aria-label={label}>{options.map(option => <label key={option.value}><input type="checkbox" checked={value.includes(option.value)}
    onChange={event => onChange(event.target.checked ? [...value, option.value] : value.filter(id => id !== option.value))} />{option.label}</label>)}</fieldset>;
}
