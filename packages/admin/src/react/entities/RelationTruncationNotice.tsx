import type { ReactNode } from 'react';
import { entityText, type EntityTranslate } from './types.js';
import { RELATION_OPTION_LIMIT, type RelationIndex } from './rules.js';

/** Names every relation target whose option set was cut at the limit; renders nothing otherwise. */
export function RelationTruncationNotice({ relations, translate }: {
  readonly relations: RelationIndex; readonly translate: EntityTranslate;
}): ReactNode {
  const truncated = Object.entries(relations).filter(([, options]) => options.truncated).map(([name]) => name);
  return truncated.length > 0 ? <p>{entityText({ translate, key: 'Related names limited to {limit} rows: {targets}', values: { limit: RELATION_OPTION_LIMIT, targets: truncated.join(', ') } })}</p> : null;
}
