import { useCallback, useMemo, useState } from 'react';
import type { EntityListProps } from './types.js';
import { loadRelationIndex, resolveEntityPageSize } from './rules.js';
import { useEntityRead } from './use-entity-read.js';

/** Track cursor history and read the selected page with its relation labels. */
export function useEntityList({ entityName, registry, limitParam, refreshToken, search }: Pick<EntityListProps, 'entityName' | 'registry' | 'limitParam' | 'refreshToken' | 'search'>, { useReadHook = useEntityRead }: { readonly useReadHook?: typeof useEntityRead } = {}) {
  const port = useMemo(() => registry.getEntity({ name: entityName }), [registry, entityName]);
  const limit = resolveEntityPageSize({ raw: limitParam });
  const text = search === null || search === undefined || search === '' ? undefined : search;
  const token = JSON.stringify([entityName, limit, text ?? null]);
  const [walk, setWalk] = useState({ token, port, entries: [{ cursor: null as string | null, offset: 0 }] });
  const walkIsCurrent = walk.token === token && walk.port === port;
  if (!walkIsCurrent) setWalk({ token, port, entries: [{ cursor: null, offset: 0 }] });
  const entries = walkIsCurrent ? walk.entries : [{ cursor: null, offset: 0 }];
  const position = entries[entries.length - 1]!;
  const load = useCallback(async () => {
    if (port === null) return null;
    const [page, relations] = await Promise.all([
      port.list({ limit, ...(position.cursor === null ? {} : { cursor: position.cursor }), ...(text === undefined ? {} : { search: text }) }),
      loadRelationIndex({ descriptor: port.descriptor, registry }),
    ]);
    return { page, relations };
  }, [port, registry, limit, position.cursor, text]);
  const result = useReadHook({ load, scope: port, refreshToken });
  return { port, entries, position, setWalk, result };
}
