import { nowIso } from '@jini-ai/core/primitives';
import type { CatalogBuilderArgs, ToolCatalogEntry, ToolCatalogQuery } from './ports.js';

/** Live overview, preserving registration order; vocabulary and source policy are host-owned. */
export function listToolCatalogEntries(
  required: Pick<CatalogBuilderArgs, 'source' | 'enricher' | 'classifier'>,
): ToolCatalogEntry[] {
  return required.source.list().map(descriptor => ({
    id: descriptor.id,
    source: required.classifier.classify({ id: descriptor.id }),
    description: required.enricher.authoredDescription({ description: descriptor.description ?? '' }),
  }));
}

/** Disposable discovery snapshot; no SQLite construction or provider import in this builder.
 * Descriptor, enrichment, source-classification and backend construction are host ports; this
 * assembly does not import the storage catalog or a concrete ranking provider. Search defaults
 * to ten hits while ranking belongs to the backend. Authored descriptions stay in the snapshot,
 * so keyword-only indexed text never leaks as a human description, including empty authored text.
 * Duplicate IDs reject before backend allocation and invalid limits before backend queries.
 * Input-schema references are immutable by host/backend agreement. Enrichment marker/dictionaries
 * and source naming policy belong to the host; no product policy is selected here.
 * The host owns backend disposal after rebinding; scalar HTTP route adapters can translate to
 * query.search({ query }, { limit }) and query.describe({ id }) at their own boundary. */
export function buildToolCatalogQuery(
  required: CatalogBuilderArgs,
  optional: { includeSearchKeywords?: boolean; includeDoc2query?: boolean } = {},
): ToolCatalogQuery {
  const descriptors = [...required.source.list()];
  if (new Set(descriptors.map(descriptor => descriptor.id)).size !== descriptors.length) {
    throw new Error('catalog tool IDs must be unique');
  }
  const authored = new Map<string, string>();
  const entries = descriptors.map(descriptor => {
    const description = descriptor.description ?? '';
    authored.set(descriptor.id, required.enricher.authoredDescription({ description }));
    return {
      id: descriptor.id,
      source: required.classifier.classify({ id: descriptor.id }),
      description: (optional.includeSearchKeywords ?? true)
        ? required.enricher.indexedDescription({ id: descriptor.id, description,
          ...(descriptor.metadata ? { metadata: descriptor.metadata } : {}),
        }, {
          includeDoc2query: optional.includeDoc2query ?? true,
        }) : description,
      ...(descriptor.inputSchema === undefined ? {} : { inputSchema: descriptor.inputSchema }),
    };
  });
  const store = required.storeFactory.create({ entries, builtAtIso: nowIso({ clock: required.clock }) });
  const descriptionFor = (entry: ToolCatalogEntry): string => authored.get(entry.id)
    ?? required.enricher.authoredDescription({ description: entry.description });
  return {
    search({ query }, { limit = 10 } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('catalog limit must be a nonnegative integer');
      return store.search({ query }, { limit }).map(hit => ({ ...hit, description: descriptionFor(hit) }));
    },
    describe({ id }) {
      const entry = store.describe({ id });
      return entry === null ? null : { ...entry, description: descriptionFor(entry) };
    },
  };
}

export interface LiveToolCatalogQuery {
  readonly query: ToolCatalogQuery;
  /** Resource retirement belongs to the host, independently of swapping this binding. */
  rebind(required: { next: ToolCatalogQuery }): void;
}

/** Stable query identity delegates every request to the most recently bound snapshot.
 * Rebinding swaps subsequent requests without changing the object routes already hold.
 * Backend retirement is separate and host-owned; the live overview re-reads the descriptor
 * source each time rather than promising that a disposable search snapshot is automatically fresh. */
export function createLiveToolCatalogQuery(required: { initial: ToolCatalogQuery }): LiveToolCatalogQuery {
  let current = required.initial;
  return {
    query: {
      search: (required, optional) => current.search(required, optional),
      describe: required => current.describe(required),
    },
    rebind({ next }) { current = next; },
  };
}
