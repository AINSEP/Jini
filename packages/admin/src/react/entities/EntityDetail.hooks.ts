import { useCallback, useMemo } from 'react';
import type { EntityDetailProps } from './types.js';
import { loadEntityRow, useEntityRead } from './use-entity-read.js';

/** Read the selected entity and discard results from an obsolete registry or route. */
export function useEntityDetail({ registry, entityName, id, refreshToken }: Pick<EntityDetailProps, 'registry' | 'entityName' | 'id' | 'refreshToken'>, _options = {}) {
  const port = useMemo(() => registry.getEntity({ name: entityName }), [registry, entityName]);
  const load = useCallback(() => loadEntityRow({ registry, entityName, id }), [registry, entityName, id, port]);
  const result = useEntityRead({ load, scope: port, refreshToken });
  return { port, result };
}
