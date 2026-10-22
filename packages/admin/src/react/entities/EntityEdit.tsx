import { useId, useMemo, type ReactNode } from 'react';
import type { AdminEntityField, AdminErasedEntityPort } from '../../core/ports/entities.js';
import type { EntityEditProps, EntityTranslate } from './types.js';
import { EntityField } from './EntityField.js';
import { RelationTruncationNotice } from './RelationTruncationNotice.js';
import { useEntityEdit } from './use-entity-edit.js';
import { entityText } from './types.js';
import type { RelationIndex } from './rules.js';

type EntityEditState = ReturnType<typeof useEntityEdit>;
type EntityEditForm = NonNullable<EntityEditState['form']>;

function EntityFieldRow({ edit, form, field, inputId, relations, translate }: {
  readonly edit: EntityEditState; readonly form: EntityEditForm; readonly field: AdminEntityField; readonly inputId: string;
  readonly relations: RelationIndex; readonly translate: EntityTranslate;
}): ReactNode {
  const missing = edit.missing.includes(field.name);
  const invalid = edit.invalid.some((problem) => problem.field === field.name);
  const jsonError = form.jsonErrors[field.name] === true;
  return <div>
    <label htmlFor={inputId}>{translate({ key: field.label ?? field.name })}{field.required ? ' *' : ''}{field.kind === 'datetime' ? ` (${translate({ key: 'UTC' })})` : ''}</label>
    <EntityField inputId={inputId} field={field} value={form.draft[field.name]} text={form.jsonText[field.name] ?? ''}
      relations={relations} translate={translate} disabled={edit.pending !== null} invalid={missing || invalid || jsonError}
      onChange={({ value }) => edit.setField({ name: field.name, value })}
      onTextChange={({ text }) => edit.setJsonText({ name: field.name, text })} />
    {missing ? <p>{translate({ key: 'Required' })}</p> : null}
    {invalid ? <p>{translate({ key: 'Invalid value' })}</p> : null}
    {jsonError ? <p role="alert">{translate({ key: 'Invalid JSON' })}</p> : null}
  </div>;
}

function EditActions({ edit, canRemove, translate }: {
  readonly edit: EntityEditState; readonly canRemove: boolean; readonly translate: EntityTranslate;
}): ReactNode {
  return <>
    <button type="submit" disabled={!edit.canSave}>{translate({ key: edit.pending === 'save' ? 'Saving' : 'Save' })}</button>
    {canRemove ? <button type="button" disabled={edit.pending !== null} onClick={() => { void edit.remove(); }}>{translate({ key: edit.pending === 'remove' ? 'Deleting' : 'Delete' })}</button> : null}
  </>;
}

function EntityEditor(props: EntityEditProps & { readonly port: AdminErasedEntityPort }) {
  const { port, translate, routes, entityName, id } = props;
  const formId = useId();
  const edit = useEntityEdit(props);
  if (edit.read.error) return <p role="alert">{translate({ key: 'Unable to load row' })}</p>;
  if (edit.read.loading || !edit.read.data) return <p role="status">{translate({ key: 'Loading' })}</p>;
  // useEntityEdit builds the form in the same render its row arrives, so once data has loaded the
  // only way to have no form is an edit route whose row does not exist.
  const { form } = edit;
  if (!form) return <p role="status">{translate({ key: 'Row not found' })}</p>;
  const { relations } = edit.read.data;
  return <form className="page" onSubmit={(e) => { e.preventDefault(); void edit.save(); }}>
    <a href={routes.href({ entity: entityName })}>{translate({ key: port.descriptor.labelPlural })}</a>
    <h1>{entityText({ translate, key: id === null ? 'New {entity}' : 'Edit {entity}', values: { entity: translate({ key: port.descriptor.labelSingular }) } })}</h1>
    {edit.failed ? <p role="alert">{translate({ key: 'Operation failed' })}</p> : null}
    {port.descriptor.fields.map((field, index) =>
      <EntityFieldRow key={field.name} edit={edit} form={form} field={field} inputId={`${formId}-${index}`} relations={relations} translate={translate} />)}
    <RelationTruncationNotice relations={relations} translate={translate} />
    <EditActions edit={edit} canRemove={id !== null && port.remove !== undefined} translate={translate} />
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
