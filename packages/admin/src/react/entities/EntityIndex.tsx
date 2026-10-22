import { DataTable } from '../components/DataTable.js';
import type { EntityScreenDependencies } from './types.js';

export function EntityIndex({ registry, routes, translate }: EntityScreenDependencies) {
  return <div className="page">
    <h1>{translate({ key: 'Data' })}</h1>
    <DataTable rows={[...registry.listEntities({})]} rowKey={({ descriptor }) => descriptor.name}
      empty={<p>{translate({ key: 'No entities registered' })}</p>}
      columns={[
        { key: 'name', header: translate({ key: 'Entity' }), cell: ({ descriptor }) => <a href={routes.href({ entity: descriptor.name })}>{translate({ key: descriptor.labelPlural })}</a> },
        { key: 'key', header: translate({ key: 'Name' }), cell: ({ descriptor }) => <code>{descriptor.name}</code> },
        { key: 'fields', header: translate({ key: 'Fields' }), cell: ({ descriptor }) => descriptor.fields.length },
      ]} />
  </div>;
}
