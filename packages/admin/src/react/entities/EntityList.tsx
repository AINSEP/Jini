import type { AdminEntityRowData } from '../../core/ports/entities.js';
import { DataTable } from '../components/DataTable.js';
import { EntityCell } from './EntityCell.js';
import { RelationTruncationNotice } from './RelationTruncationNotice.js';
import { entityText, type EntityListProps } from './types.js';
import { useEntityList } from './EntityList.hooks.js';

/** Cursor history records actual returned page lengths; never sort a server-paginated page locally.
 * Host translation, registry and navigation are injected, and this list uses the existing DataTable.
 * Relation choices are bounded to 100, expose truncation and retain raw IDs for unresolved labels.
 */
export function EntityList({ useListHook = useEntityList, ...props }: EntityListProps & { readonly useListHook?: typeof useEntityList }) {
  const { entityName, registry, translate, routes } = props;
  const { port, entries, position, setWalk, result } = useListHook({ entityName, registry, limitParam: props.limitParam, refreshToken: props.refreshToken, search: props.search });
  if (port === null) return <p role="alert">{translate({ key: 'Unknown entity' })}</p>;
  if (result.error) return <p role="alert">{translate({ key: 'Unable to load rows' })}</p>;
  if (result.loading || !result.data) return <p role="status">{translate({ key: 'Loading' })}</p>;
  const { page, relations } = result.data;
  const descriptor = port.descriptor;
  return <div className="page">
    <a href={routes.href({})}>{translate({ key: 'Data' })}</a>
    <h1>{translate({ key: descriptor.labelPlural })}</h1>
    <a href={routes.href({ entity: entityName, view: 'create' })}>{entityText({ translate, key: 'New {entity}', values: { entity: translate({ key: descriptor.labelSingular }) } })}</a>
    <DataTable<AdminEntityRowData> rows={[...page.items]} rowKey={(row) => row.id} empty={<p>{translate({ key: 'No rows' })}</p>}
      columns={descriptor.fields.map((field) => ({
        key: field.name, header: translate({ key: field.label ?? field.name }),
        // Sorting a server-cut page would misrepresent collection order.
        cell: (row) => field.name === descriptor.titleField
          ? <a href={routes.href({ entity: entityName, id: row.id })}><EntityCell field={field} row={row} relations={relations} translate={translate} /></a>
          : <EntityCell field={field} row={row} relations={relations} translate={translate} />,
      }))} />
    <p>{page.items.length === 0 ? translate({ key: 'No rows' }) : entityText({ translate, key: 'Showing {from}–{to}', values: { from: position.offset + 1, to: position.offset + page.items.length } })}</p>
    <button type="button" disabled={entries.length === 1} onClick={() => setWalk((current) => ({ ...current, entries: current.entries.slice(0, -1) }))}>{translate({ key: 'Previous' })}</button>
    <button type="button" disabled={page.nextCursor === null} onClick={() => {
      if (page.nextCursor !== null) setWalk((current) => ({ ...current, entries: [...current.entries, { cursor: page.nextCursor, offset: position.offset + page.items.length }] }));
    }}>{translate({ key: 'Next' })}</button>
    <RelationTruncationNotice relations={relations} translate={translate} />
  </div>;
}
