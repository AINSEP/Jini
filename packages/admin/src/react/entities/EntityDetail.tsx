import { EntityCell } from './EntityCell.js';
import type { EntityDetailProps } from './types.js';
import { useEntityDetail } from './EntityDetail.hooks.js';
import { readTitle } from './rules.js';

export function EntityDetail({ entityName, id, registry, translate, routes, refreshToken, useDetailHook = useEntityDetail }: EntityDetailProps & { readonly useDetailHook?: typeof useEntityDetail }) {
  const { port, result } = useDetailHook({ registry, entityName, id, refreshToken });
  if (port === null) return <p role="alert">{translate({ key: 'Unknown entity' })}</p>;
  if (result.error) return <p role="alert">{translate({ key: 'Unable to load row' })}</p>;
  if (result.loading || !result.data) return <p role="status">{translate({ key: 'Loading' })}</p>;
  const { row, relations } = result.data;
  if (row === null) return <p role="status">{translate({ key: 'Row not found' })}</p>;
  return <div className="page">
    <a href={routes.href({ entity: entityName })}>{translate({ key: port.descriptor.labelPlural })}</a>
    <h1>{readTitle({ row, titleField: port.descriptor.titleField }) ?? row.id}</h1>
    <dl>{port.descriptor.fields.map((field) => <div key={field.name}>
      <dt>{translate({ key: field.label ?? field.name })}</dt>
      <dd><EntityCell field={field} row={row} relations={relations} translate={translate} /></dd>
    </div>)}</dl>
    <a href={routes.href({ entity: entityName, id, view: 'edit' })}>{translate({ key: 'Edit' })}</a>
  </div>;
}
