import { Select } from '@jini-ai/ui/admin-widgets';
import type { AdminEntityField } from '../../core/ports/entities.js';
import type { EntityTranslate } from './types.js';
import { fromDatetimeLocalValue, toDatetimeLocalValue, type RelationIndex } from './rules.js';

export function EntityField(props: {
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
}) {
  const { inputId, field, value, translate, disabled, invalid, onChange } = props;
  const common = { id: inputId, disabled, 'aria-invalid': invalid };
  switch (field.kind) {
    case 'json': return <textarea {...common} value={props.text} onChange={(e) => props.onTextChange({ text: e.target.value })} />;
    case 'relation': {
      const options = props.relations[field.target]?.options ?? [];
      const selectedId = typeof value === 'string' ? value : '';
      const missing = selectedId !== '' && !options.some((option) => option.id === selectedId);
      return <Select id={inputId} disabled={disabled} value={selectedId} translate={(key) => translate({ key })}
        aria-label={translate({ key: field.label ?? field.name })}
        options={[
          { value: '', label: translate({ key: 'No value' }) },
          ...(missing ? [{ value: selectedId, label: `${selectedId} (${translate({ key: 'Unresolved' })})` }] : []),
          ...options.map((option) => ({ value: option.id, label: option.title })),
        ]} onChange={(selected) => onChange({ value: selected === '' ? undefined : selected })} />;
    }
    case 'boolean':
      if (field.required) return <input {...common} type="checkbox" checked={value === true} onChange={(e) => onChange({ value: e.target.checked })} />;
      return <Select id={inputId} disabled={disabled} value={value === undefined ? '' : value === true ? 'true' : 'false'} translate={(key) => translate({ key })}
        aria-label={translate({ key: field.label ?? field.name })} options={[
          { value: '', label: translate({ key: 'No value' }) }, { value: 'true', label: translate({ key: 'Yes' }) }, { value: 'false', label: translate({ key: 'No' }) },
        ]} onChange={(selected) => onChange({ value: selected === '' ? undefined : selected === 'true' })} />;
    case 'datetime': return <input {...common} type="datetime-local" step="0.001" value={toDatetimeLocalValue({ value })}
      onChange={(e) => onChange({ value: fromDatetimeLocalValue({ raw: e.target.value }) })} />;
    case 'integer':
    case 'real': return <input {...common} type="number" step={field.kind === 'integer' ? '1' : 'any'} value={typeof value === 'number' ? value : ''}
      onChange={(e) => onChange({ value: e.target.value === '' ? undefined : Number(e.target.value) })} />;
    case 'text': return <input {...common} value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange({ value: e.target.value === '' ? undefined : e.target.value })} />;
  }
}
