import type { AdminNavEntry } from '../../core/manifest/types.js';
import type { AdminShellPanel } from '../shell/types.js';
import type { EntityRegistryPort, EntityRoutesPort, EntityRouteTarget, EntityTranslate } from './types.js';
import { EntityIndex } from './EntityIndex.js';
import { EntityList } from './EntityList.js';
import { EntityDetail } from './EntityDetail.js';
import { EntityEdit } from './EntityEdit.js';

export interface EntityRouteDependencies {
  readonly adminBase: string;
  readonly panelId: string;
  readonly navigate: (args: { readonly routePath: string }) => void;
}

function encodeSegment({ value }: { readonly value: string }): string {
  if (value === '') throw new Error('Entity route segments must be non-empty');
  const encoded = encodeURIComponent(value).replace(/~/g, '%7E');
  // Browsers normalize even percent-encoded dot segments. A marker prevents that normalization.
  return value === '.' || value === '..' ? `~${encoded}` : encoded;
}

function decodeSegment({ value }: { readonly value: string }): string {
  return value === '~.' || value === '~..' ? value.slice(1) : decodeURIComponent(value);
}

export function createEntityRoutes({ adminBase, panelId, navigate }: EntityRouteDependencies): EntityRoutesPort {
  if (!/^[a-zA-Z0-9_-]+$/.test(panelId)) throw new Error('Entity panelId must be one URL segment');
  if (!adminBase.startsWith('/') || adminBase.startsWith('//') || /[?#]/.test(adminBase)) throw new Error('Entity adminBase must be an absolute pathname');
  const base = adminBase.replace(/\/+$/, '');
  function routePath({ entity, id, view }: EntityRouteTarget): string {
    const root = `/${panelId}`;
    if (entity === undefined) return root;
    const list = `${root}/${encodeSegment({ value: entity })}`;
    if (view === 'create') return `${list}/new`;
    if (id === undefined) return list;
    return `${list}/row/${encodeSegment({ value: id })}${view === 'edit' ? '/edit' : ''}`;
  }
  return {
    href: (args) => `${base}${routePath(args)}`,
    navigate: (args) => navigate({ routePath: routePath(args) }),
  };
}

/** Adds an existing shell contribution; no router, registry, or shell is installed by this slice.
 * Host translate/registry/adminBase/panelId/navigation dependencies are explicit and agent access
 * is opt-in. List/create/detail/edit routes encode names and IDs, including dot-segment protection;
 * an ID equal to new is still a saved row, never the creation sentinel. Hosts adopting these routes
 * own legacy bookmark migration. Select translation is adapted to its existing scalar callback ABI. */
export function createEntityPanel(
  args: EntityRouteDependencies & { readonly registry: EntityRegistryPort; readonly translate: EntityTranslate },
  options: { readonly nav?: AdminNavEntry; readonly agentReachable?: boolean; readonly requires?: readonly string[]; readonly permissions?: readonly string[] } = {},
): AdminShellPanel {
  const routes = createEntityRoutes(args);
  const dependencies = { registry: args.registry, translate: args.translate, routes };
  return {
    id: args.panelId,
    nav: options.nav ?? { label: args.translate({ key: 'Data' }) },
    agentReachable: options.agentReachable ?? false,
    ...(options.requires === undefined ? {} : { requires: options.requires }),
    ...(options.permissions === undefined ? {} : { permissions: options.permissions }),
    routes: [
      { pattern: '/:entity', view: 'list' },
      { pattern: '/:entity/new', view: 'create' },
      { pattern: '/:entity/row/:id', view: 'detail' },
      { pattern: '/:entity/row/:id/edit', view: 'edit' },
    ],
    render: ({ route }) => {
      if (route.view === null) return <EntityIndex {...dependencies} />;
      let entityName: string;
      let id: string;
      try {
        entityName = decodeSegment({ value: route.params.entity ?? '' });
        id = decodeSegment({ value: route.params.id ?? '' });
      } catch { return <p role="alert">{args.translate({ key: 'Invalid route' })}</p>; }
      if (route.view === 'list') return <EntityList {...dependencies} entityName={entityName} limitParam={route.query.get('limit')} />;
      if (route.view === 'detail') return <EntityDetail {...dependencies} entityName={entityName} id={id} />;
      return <EntityEdit {...dependencies} entityName={entityName} id={route.view === 'create' ? null : id} />;
    },
  };
}
