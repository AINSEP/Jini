import type { SearchProviderContext } from '../../contract.js';
import { createUnavailableHttpClient } from '../fakes.js';

/** A working context for the in-memory provider (it ignores credentials and HTTP). */
export function memoryContext(required: { readonly siteId: string; readonly indexName: string }, optional: { readonly down?: boolean } = {}): SearchProviderContext {
  return {
    workspaceId: 'ws_conformance', siteId: required.siteId, indexName: required.indexName, mode: 'test',
    credentials: optional.down === true ? { down: 'true' } : {}, httpClient: createUnavailableHttpClient(), timeoutMs: 1000, now: () => 0,
  };
}

export const isUp = ({ ctx }: { readonly ctx: SearchProviderContext }): boolean => ctx.credentials.down !== 'true';
