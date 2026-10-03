import { randomUUID } from 'node:crypto';
import * as implementation from '../tool-audit.js';

export const SEARCH_TOOLS_TOOL_ID = 'search_tools';
export const DESCRIBE_TOOL_TOOL_ID = 'describe_tool';
type Hit = { id: string; description: string; source: string; score: number };
type Entry = { id: string; description: string };
type Options = implementation.ToolAuditOptions & { now?: () => string; newAttemptId?: () => string };
/** Fake host catalog: these tests cover audit attribution, never search-provider ranking. */
export function buildToolCatalogQuery(registry: { list(args: Record<string, never>): readonly Entry[] }, _options = {}) {
  return {
    search({ query }: { query: string }, { limit }: { limit?: number } = {}): Hit[] {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      return registry.list({}).filter(entry => words.every(word => entry.description.toLowerCase().includes(word))).slice(0, limit ?? 10).map(entry => ({ ...entry, source: 'fixture', score: 1 }));
    },
    describe: ({ id }: { id: string }) => registry.list({}).find(entry => entry.id === id) ?? null,
  };
}
export const searchToolsAuditDetail = (query: string, limit: number | null, hits: readonly Hit[]) => implementation.searchToolsAuditDetail({ query, limit, hits });
export const describeToolAuditDetail = (id: string, entry: Entry | null) => implementation.describeToolAuditDetail({ id, entry });
export function appendToolCatalogAttempt(sink: implementation.ToolAttemptAuditSink, event: implementation.ToolCatalogAttemptEvent, options: Options = {}) {
  implementation.appendToolCatalogAttempt({ sink, event, now: options.now ?? (() => new Date().toISOString()), newAttemptId: options.newAttemptId ?? randomUUID }, options);
}
export function withToolCatalogAudit(catalog: implementation.ToolCatalogAuditSource<Hit, Entry>, sink: implementation.ToolAttemptAuditSink, identity: implementation.ToolCatalogAuditIdentity, options: Options = {}) {
  const audited = implementation.withToolCatalogAudit({ catalog, sink, identity, searchToolId: SEARCH_TOOLS_TOOL_ID, describeToolId: DESCRIBE_TOOL_TOOL_ID, now: options.now ?? (() => new Date().toISOString()), newAttemptId: options.newAttemptId ?? randomUUID }, options);
  return { search: (query: string, limit?: number) => audited.search({ query }, limit === undefined ? {} : { limit }), describe: (id: string) => audited.describe({ id }) };
}
