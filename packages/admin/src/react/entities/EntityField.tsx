import type { ReactNode } from 'react';
import { Select } from '@jini-ai/ui/admin-widgets';
import type { AdminEntityField, AdminEntityRelationField } from '../../core/ports/entities.js';
import { selectTranslate, type EntityTranslate } from './types.js';
import { fromDatetimeLocalValue, toDatetimeLocalValue, type RelationIndex } from './rules.js';

interface EntityFieldProps {
  readonly inputId: string;
  readonly field: AdminEntityField;
  readonly value: unknown;
  readonly text: string;
  readonly relations: RelationIndex;
  readonly translate: EntityTranslate;
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly onChange: (args: { readonly value: unknown }) => void;
  readonly onTextChange: (args: { readonly text: string }) => void;
}

const fieldLabel = ({ field, translate }: Pick<EntityFieldProps, 'field' | 'translate'>): string => translate({ key: field.label ?? field.name });
const blankToUndefined = (raw: string): string | undefined => (raw === '' ? undefined : raw);
const commonProps = ({ inputId, disabled, invalid }: EntityFieldProps) => ({ id: inputId, disabled, 'aria-invalid': invalid });

function RelationInput(props: EntityFieldProps & { readonly field: AdminEntityRelationField }): ReactNode {
  const { inputId, field, value, translate, disabled, onChange } = props;
  const options = props.relations[field.target]?.options ?? [];
  const selectedId = typeof value === 'string' ? value : '';
  const missing = selectedId !== '' && !options.some((option) => option.id === selectedId);
  return <Select id={inputId} disabled={disabled} value={selectedId} translate={selectTranslate({ translate })}
    aria-label={fieldLabel(props)}
    options={[
      { value: '', label: translate({ key: 'No value' }) },
      ...(missing ? [{ value: selectedId, label: `${selectedId} (${translate({ key: 'Unresolved' })})` }] : []),
      ...options.map((option) => ({ value: option.id, label: option.title })),
    ]} onChange={(selected) => onChange({ value: blankToUndefined(selected) })} />;
}

function booleanSelectValue(value: unknown): string {
  if (value === undefined) return '';
  return value === true ? 'true' : 'false';
}

function BooleanInput(props: EntityFieldProps): ReactNode {
  const { inputId, field, value, translate, disabled, onChange } = props;
  if (field.required) return <input {...commonProps(props)} type="checkbox" checked={value === true} onChange={(e) => onChange({ value: e.target.checked })} />;
  return <Select id={inputId} disabled={disabled} value={booleanSelectValue(value)} translate={selectTranslate({ translate })}
    aria-label={fieldLabel(props)} options={[
      { value: '', label: translate({ key: 'No value' }) }, { value: 'true', label: translate({ key: 'Yes' }) }, { value: 'false', label: translate({ key: 'No' }) },
    ]} onChange={(selected) => onChange({ value: selected === '' ? undefined : selected === 'true' })} />;
}

function NumberInput(props: EntityFieldProps): ReactNode {
  const { field, value, onChange } = props;
  return <input {...commonProps(props)} type="number" step={field.kind === 'integer' ? '1' : 'any'} value={typeof value === 'number' ? value : ''}
    onChange={(e) => onChange({ value: e.target.value === '' ? undefined : Number(e.target.value) })} />;
}

export function EntityField(props: EntityFieldProps): ReactNode {
  const { field, value, onChange } = props;
  switch (field.kind) {
    case 'json': return <textarea {...commonProps(props)} value={props.text} onChange={(e) => props.onTextChange({ text: e.target.value })} />;
    case 'relation': return <RelationInput {...props} field={field} />;
    case 'boolean': return <BooleanInput {...props} />;
    case 'datetime': return <input {...commonProps(props)} type="datetime-local" step="0.001" value={toDatetimeLocalValue({ value })}
      onChange={(e) => onChange({ value: fromDatetimeLocalValue({ raw: e.target.value }) })} />;
    case 'integer':
    case 'real': return <NumberInput {...props} />;
    case 'text': return <input {...commonProps(props)} value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange({ value: blankToUndefined(e.target.value) })} />;
    default: return null;
  }
}
