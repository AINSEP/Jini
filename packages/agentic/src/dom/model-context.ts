/**
 * @module @jini/ui/features/agent-tools/model-context
 *
 * Feature-detected access to the browser's (draft) WebMCP surface —
 * `document.modelContext`, falling back to the deprecated `navigator.modelContext`
 * alias (the spec moved the getter from Navigator to Document in 2026;
 * see the polyfill ecosystem's own back-compat posture). No `@mcp-b/*` or
 * other WebMCP package dependency: this package only needs the shape, the
 * same "typed global + validated getter + graceful unavailable path"
 * pattern `@jini/desktop-host`'s `bridge.ts` and this app's own
 * `desktop-bridge.ts` already use for other host-provided globals.
 * A page that wants `document.modelContext` to actually exist in a browser
 * without native support must load a real polyfill itself (e.g.
 * `@mcp-b/webmcp-polyfill`) — this module only ever reads what's there.
 */

export interface AgentModelContextToolRegistration {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface AgentModelContextLike {
  registerTool(tool: AgentModelContextToolRegistration, options?: { signal?: AbortSignal }): void;
  unregisterTool?(name: string): void;
}

function isModelContext(value: unknown): value is AgentModelContextLike {
  return typeof value === 'object' && value !== null && typeof (value as AgentModelContextLike).registerTool === 'function';
}

/** Returns the page's WebMCP surface if one is installed (native or polyfilled), or `undefined`. */
export function getAgentModelContext(): AgentModelContextLike | undefined {
  const doc = (globalThis as { document?: { modelContext?: unknown } }).document;
  if (isModelContext(doc?.modelContext)) return doc.modelContext;
  const nav = (globalThis as { navigator?: { modelContext?: unknown } }).navigator;
  if (isModelContext(nav?.modelContext)) return nav.modelContext;
  return undefined;
}
