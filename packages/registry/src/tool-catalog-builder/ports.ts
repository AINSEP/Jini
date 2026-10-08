import type { Clock } from '@jini-ai/core/primitives';
import type { ToolMetadata } from '@jini-ai/core';
/** Structural contracts only: callers choose their registry and search backend. */
export interface ToolDescriptor {
  readonly metadata?: ToolMetadata;
  readonly id: string;
  readonly description?: string | undefined;
  readonly inputSchema?: unknown;
}
export interface ToolDescriptorSource { list(): readonly ToolDescriptor[] }
export interface ToolCatalogEntry {
  readonly id: string;
  readonly source: string;
  readonly description: string;
  readonly inputSchema?: unknown;
}
export interface ToolCatalogHit extends ToolCatalogEntry { readonly score: number }
export interface ToolCatalogQuery {
  search(required: { query: string }, optional?: { limit?: number }): ToolCatalogHit[];
  describe(required: { id: string }): ToolCatalogEntry | null;
}
export interface CatalogStoreFactory {
  /** Owns backend resources. The host disposes them separately when a snapshot is retired. */
  create(required: { entries: readonly ToolCatalogEntry[]; builtAtIso: string }): ToolCatalogQuery;
}
export interface SearchEnricher {
  indexedDescription(required: { id: string; description: string; metadata?: ToolMetadata }, optional: { includeDoc2query: boolean }): string;
  authoredDescription(required: { description: string }): string;
}
export interface SourceClassifier { classify(required: { id: string }): string }

export interface CatalogBuilderArgs {
  source: ToolDescriptorSource;
  storeFactory: CatalogStoreFactory;
  enricher: SearchEnricher;
  classifier: SourceClassifier;
  clock: Clock;
}
