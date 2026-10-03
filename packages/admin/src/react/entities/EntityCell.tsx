import type { AdminEntityField, AdminEntityRowData } from '../../core/ports/entities.js';
import { entityText, type EntityTranslate } from './types.js';
import type { RelationIndex } from './rules.js';

export function EntityCell({ field, row, relations, translate }: {
  readonly field: AdminEntityField;
  readonly row: AdminEntityRowData;
  readonly relations: RelationIndex;
  readonly translate: EntityTranslate;
}) {
  const value = row[field.name];
  if (value === undefined || value === null) return <span>{translate({ key: 'Empty' })}</span>;
  if (field.kind === 'relation') {
    const id = String(value);
    const title = relations[field.target]?.titles?.[id];
    return title !== undefined ? <span>{title}</span> : <span title={entityText({ translate, key: 'Unresolved {target}: {id}', values: { target: field.target, id } })}>{id} ⚠</span>;
  }
  if (field.kind === 'json') return <code>{JSON.stringify(value)}</code>;
  if (field.kind === 'boolean') return <span>{translate({ key: value === true ? 'Yes' : 'No' })}</span>;
  return <span>{String(value)}</span>;
}
