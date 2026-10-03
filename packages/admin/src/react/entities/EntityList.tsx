import { useCallback, useMemo, useState } from 'react';
import type { AdminEntityRowData } from '../../core/ports/entities.js';
import { DataTable } from '../components/DataTable.js';
import { EntityCell } from './EntityCell.js';
import { entityText, type EntityListProps } from './types.js';
import { loadRelationIndex, resolveEntityPageSize, RELATION_OPTION_LIMIT } from './rules.js';
import { useEntityRead } from './use-entity-read.js';

/** Cursor history records actual returned page lengths; never sort a server-paginated page locally.
 * Host translation, registry and navigation are injected, and this list uses the existing DataTable.
 * Relation choices are bounded to 100, expose truncation and retain raw IDs for unresolved labels.
 */
export function EntityList(props: EntityListProps) {
  const { entityName, registry, translate, routes } = props;
  const port = useMemo(() => registry.getEntity({ name: entityName }), [registry, entityName]);
  const limit = resolveEntityPageSize({ raw: props.limitParam });
  const token = JSON.stringify([entityName, limit]);
  const [walk, setWalk] = useState({ token, port, entries: [{ cursor: null as string | null, offset: 0 }] });
  if (walk.token !== token || walk.port !== port) setWalk({ token, port, entries: [{ cursor: null, offset: 0 }] });
  const entries = walk.token === token && walk.port === port ? walk.entries : [{ cursor: null, offset: 0 }];
  const position = entries[entries.length - 1]!;
  const load = useCallback(async () => {
    if (port === null) return null;
    const [page, relations] = await Promise.all([
      port.list(position.cursor === null ? { limit } : { limit, cursor: position.cursor }),
      loadRelationIndex({ descriptor: port.descriptor, registry }),
    ]);
    return { page, relations };
  }, [port, registry, limit, position.cursor]);
  const result = useEntityRead({ load, scope: port });
  if (port === null) return <p role="alert">{translate({ key: 'Unknown entity' })}</p>;
  if (result.error) return <p role="alert">{translate({ key: 'Unable to load rows' })}</p>;
  if (result.loading || !result.data) return <p role="status">{translate({ key: 'Loading' })}</p>;
  const { page, relations } = result.data;
  const descriptor = port.descriptor;
  const truncated = Object.entries(relations).filter(([, options]) => options.truncated).map(([name]) => name);
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
    {truncated.length > 0 ? <p>{entityText({ translate, key: 'Related names limited to {limit} rows: {targets}', values: { limit: RELATION_OPTION_LIMIT, targets: truncated.join(', ') } })}</p> : null}
  </div>;
}
