import { AsyncLocalStorage } from "node:async_hooks";
import type { SpanScopePort, TraceSpanPort } from './ports.js';

/**
 * The active span per async context, for Node hosts: pass it as the adapter's `scope` so a DB query
 * or outbound call made while serving a request becomes that request span's child. Kept out of the
 * universal `./observability` entry because AsyncLocalStorage is Node-only. A continuation resumed
 * from a callback registered outside the scope (some stream/body-parser paths) sees no active span
 * and starts a root span: it is never attributed to the wrong request.
 * @param _required Empty; each call owns a fresh store.
 * @returns A scope port over one AsyncLocalStorage instance.
 */
export function createAsyncLocalSpanScope(_required: Record<string, never>): SpanScopePort {
 const storage = new AsyncLocalStorage<TraceSpanPort>();
 return { active: () => storage.getStore(), run: ({ span, fn }) => storage.run(span, fn) };
}
