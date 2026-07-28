/**
 * @module dom/model-context
 *
 * Feature-detected access to the browser's (draft) WebMCP surface —
 * `document.modelContext`, falling back to the deprecated `navigator.modelContext`
 * alias (the spec moved the getter from Navigator to Document in 2026;
 * see the polyfill ecosystem's own back-compat posture). No `@mcp-b/*` or
 * other WebMCP package dependency: this module only needs the shape, the
 * same "typed global + validated getter + graceful unavailable path"
 * pattern `@injini/desktop-host`'s `bridge.ts` and other host-provided-global
 * bridges already use.
 * A page that wants `document.modelContext` to actually exist in a browser
 * without native support must load a real polyfill itself (e.g.
 * `@mcp-b/webmcp-polyfill`) — this module only ever reads what's there.
 *
 * Moved 2026-07-26 from `@injini/ui/src/features/agent-tools/model-context.ts` (plan §4/§8 step 6).
 * Lives under `src/dom/`, not alongside `../webmcp.ts`'s pure `CapabilityDef` → WebMCP-tool
 * projection, because it reads `document`/`navigator` — `webmcp.ts`'s own module doc is explicit
 * that "that detection is deliberately NOT here: it touches browser globals, and this package
 * holds none," which is exactly the DOM-free guarantee `src/dom/` exists to carve an exception
 * for. See `dom/index.ts`'s re-export of this module.
 */

export interface AgentModelContextToolRegistration {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly execute: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Options `registerTool` accepts. Matches the draft's
 * `ModelContextRegisterToolOptions`: an `AbortSignal` that unregisters the tool when aborted, and
 * `exposedTo` to scope which consumers may see it.
 */
export interface AgentModelContextRegisterToolOptions {
  readonly signal?: AbortSignal;
  readonly exposedTo?: readonly string[];
}

export interface AgentModelContextLike {
  /**
   * Draft IDL: `Promise<undefined> registerTool(ModelContextTool tool, optional
   * ModelContextRegisterToolOptions options = {})` — it is **async**. Callers must not assume it
   * has taken effect synchronously, and must not let a rejection escape.
   */
  registerTool(tool: AgentModelContextToolRegistration, options?: AgentModelContextRegisterToolOptions): Promise<void>;
  /**
   * NOT in the spec — the draft's only unregistration mechanism is aborting the `signal` passed to
   * `registerTool`. Kept optional purely so a polyfill that happens to expose one can be used;
   * never rely on its presence, and always pass a `signal` as the real cleanup path.
   */
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
