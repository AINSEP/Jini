import { useEffect, useState } from 'react';
import type { AdminEntityRowData } from '../../core/ports/entities.js';
import type { EntityRegistryPort } from './types.js';
import { loadRelationIndex, type RelationIndex } from './rules.js';

/** Per-mount async state; stale results are discarded and reads never overwrite another route. */
export function useEntityRead<T>(
  { load, scope }: { readonly load: () => Promise<T>; readonly scope: unknown },
): { readonly data: T | undefined; readonly error: unknown; readonly loading: boolean } {
  const [state, setState] = useState<{ scope: unknown; load: () => Promise<T>; data?: T; error?: unknown }>({ scope, load });
  useEffect(() => {
    let active = true;
    setState({ scope, load });
    Promise.resolve().then(load).then(
      (data) => { if (active) setState({ scope, load, data }); },
      (error: unknown) => { if (active) setState({ scope, load, error }); },
    );
    return () => { active = false; };
  }, [load, scope]);
  const current = state.scope === scope && state.load === load ? state : null;
  return { data: current?.data, error: current?.error, loading: current === null || (!Object.hasOwn(current, 'data') && !Object.hasOwn(current, 'error')) };
}

export interface EntityLoadedRow {
  readonly row: AdminEntityRowData | null;
  readonly relations: RelationIndex;
}

export async function loadEntityRow(
  { registry, entityName, id }: { readonly registry: EntityRegistryPort; readonly entityName: string; readonly id: string | null },
): Promise<EntityLoadedRow> {
  const port = registry.getEntity({ name: entityName });
  if (port === null) return { row: null, relations: {} };
  const [row, relations] = await Promise.all([
    id === null ? Promise.resolve(null) : port.get(id),
    loadRelationIndex({ descriptor: port.descriptor, registry }),
  ]);
  return { row, relations };
}
