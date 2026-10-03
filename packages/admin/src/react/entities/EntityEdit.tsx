import { useId, useMemo } from 'react';
import type { AdminErasedEntityPort } from '../../core/ports/entities.js';
import type { EntityEditProps } from './types.js';
import { EntityField } from './EntityField.js';
import { useEntityEdit } from './use-entity-edit.js';
import { entityText } from './types.js';
import { RELATION_OPTION_LIMIT } from './rules.js';

function EntityEditor(props: EntityEditProps & { readonly port: AdminErasedEntityPort }) {
  const { port, translate, routes, entityName, id } = props;
  const formId = useId();
  const edit = useEntityEdit(props);
  if (edit.read.error) return <p role="alert">{translate({ key: 'Unable to load row' })}</p>;
  if (edit.read.loading || !edit.read.data) return <p role="status">{translate({ key: 'Loading' })}</p>;
  if (id !== null && edit.read.data.row === null) return <p role="status">{translate({ key: 'Row not found' })}</p>;
  if (!edit.form) return <p role="status">{translate({ key: 'Loading' })}</p>;
  const busy = edit.pending !== null;
  const truncated = Object.entries(edit.read.data.relations).filter(([, target]) => target.truncated).map(([name]) => name);
  return <form className="page" onSubmit={(e) => { e.preventDefault(); void edit.save(); }}>
    <a href={routes.href({ entity: entityName })}>{translate({ key: port.descriptor.labelPlural })}</a>
    <h1>{entityText({ translate, key: id === null ? 'New {entity}' : 'Edit {entity}', values: { entity: translate({ key: port.descriptor.labelSingular }) } })}</h1>
    {edit.failed ? <p role="alert">{translate({ key: 'Operation failed' })}</p> : null}
    {port.descriptor.fields.map((field, index) => {
      const inputId = `${formId}-${index}`;
      const missing = edit.missing.includes(field.name);
      const invalid = edit.invalid.some((problem) => problem.field === field.name);
      const jsonError = edit.form?.jsonErrors[field.name] === true;
      return <div key={field.name}>
        <label htmlFor={inputId}>{translate({ key: field.label ?? field.name })}{field.required ? ' *' : ''}{field.kind === 'datetime' ? ` (${translate({ key: 'UTC' })})` : ''}</label>
        <EntityField inputId={inputId} field={field} value={edit.form?.draft[field.name]} text={edit.form?.jsonText[field.name] ?? ''}
          relations={edit.read.data!.relations} translate={translate} disabled={busy} invalid={missing || invalid || jsonError}
          onChange={({ value }) => edit.setField({ name: field.name, value })}
          onTextChange={({ text }) => edit.setJsonText({ name: field.name, text })} />
        {missing ? <p>{translate({ key: 'Required' })}</p> : null}
        {invalid ? <p>{translate({ key: 'Invalid value' })}</p> : null}
        {jsonError ? <p role="alert">{translate({ key: 'Invalid JSON' })}</p> : null}
      </div>;
    })}
    {truncated.length > 0 ? <p>{entityText({ translate, key: 'Related names limited to {limit} rows: {targets}', values: { limit: RELATION_OPTION_LIMIT, targets: truncated.join(', ') } })}</p> : null}
    <button type="submit" disabled={!edit.canSave}>{translate({ key: edit.pending === 'save' ? 'Saving' : 'Save' })}</button>
    {id !== null && port.remove ? <button type="button" disabled={busy} onClick={() => { void edit.remove(); }}>{translate({ key: edit.pending === 'remove' ? 'Deleting' : 'Delete' })}</button> : null}
  </form>;
}

/** Host entity editing uses the existing registry/ports and core draft validation.
 * Required booleans default false, optional booleans remain unset, and invalid JSON blocks save
 * while preserving textarea contents. Creates omit undefined; updates retain explicit undefined
 * to clear fields, so the host transport must preserve that intent. Save/remove operations serialize
 * within the mounted editor; stale reads and settlement after unmount cannot populate or navigate
 * another screen. Relation targets load once each, bounded to 100 with truncation and raw-id fallback.
 * Reads belong to each mount rather than a host query singleton. Navigation remount reloads data;
 * live refresh and dirty-navigation prompts remain host responsibilities. Registry changes must
 * replace the registry object; memoized per-entity ports can then refresh diagnostic wrappers.
 */
export function EntityEdit(props: EntityEditProps) {
  const port = useMemo(() => props.registry.getEntity({ name: props.entityName }), [props.registry, props.entityName]);
  if (port === null) return <p role="alert">{props.translate({ key: 'Unknown entity' })}</p>;
  return <EntityEditor key={JSON.stringify([props.entityName, props.id])} {...props} port={port} />;
}
