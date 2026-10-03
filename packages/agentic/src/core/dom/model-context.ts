/**
 * @module dom/model-context
 *
 * Host-injected access to the browser's (draft) WebMCP surface —
 * the host supplies `document.modelContext`, followed by the deprecated `navigator.modelContext`
 * alias (the spec moved the getter from Navigator to Document in 2026;
 * see the polyfill ecosystem's own back-compat posture). No `@mcp-b/*` or
 * other WebMCP package dependency: this module only needs the shape, the
 * same "typed global + validated getter + graceful unavailable path"
 * pattern `@jini-ai/desktop-host`'s `bridge.ts` and other host-provided-global
 * bridges already use.
 * A page that wants `document.modelContext` to actually exist in a browser
 * without native support must load a real polyfill itself (e.g.
 * `@mcp-b/webmcp-polyfill`) — this module adapts only the candidates the host supplies.
 *
 * Moved 2026-07-26 from `@jini-ai/ui/src/features/agent-tools/model-context.ts` (plan §4/§8 step 6).
 * Lives under `src/dom/`, not alongside `../webmcp.ts`'s pure `CapabilityDef` → WebMCP-tool
 * projection, because it adapts the native browser API — `webmcp.ts`'s own module doc is explicit
 * that "that detection is deliberately NOT here: it touches browser globals, and this package
 * holds none," which is exactly the DOM-free guarantee `src/dom/` exists to carve an exception
 * for. See `dom/index.ts`'s re-export of this module.
 *
 * `AgentModelContextToolRegistration` gained `title`/`annotations` 2026-07-28, matching the same
 * `ModelContextTool` dict fields `../webmcp.ts`'s `WebMcpToolRegistration` closed the same day —
 * this file models the identical spec dictionary independently (no shared import; see the module
 * doc above for why the DOM/DOM-free split keeps them separate files), so the two had drifted out
 * of sync on the exact same gap. Found while wiring `examples/reference-web`'s WebMCP stress-test
 * fixture: a raw (non-`toWebMcpTool`) registration carrying a `title` failed TypeScript's
 * excess-property check against the un-widened type here.
 */

import { adaptNativeModelContext } from './native-model-context.js';

export interface AgentModelContextToolRegistration {
  readonly name: string;
  /** `ModelContextTool.title` — optional human-readable label, distinct from `name` and `description`. */
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly execute: (args: Record<string, unknown>) => Promise<unknown>;
  /** `ModelContextTool.annotations` — `{ readOnlyHint?, untrustedContentHint? }` behavior hints. */
  readonly annotations?: { readonly readOnlyHint?: boolean; readonly untrustedContentHint?: boolean };
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
  registerTool(required: { tool: AgentModelContextToolRegistration }, options?: AgentModelContextRegisterToolOptions): Promise<void>;
  /**
   * NOT in the spec — the draft's only unregistration mechanism is aborting the `signal` passed to
   * `registerTool`. Kept optional purely so a polyfill that happens to expose one can be used;
   * never rely on its presence, and always pass a `signal` as the real cleanup path.
   */
  unregisterTool?(required: { name: string }, _optional?: Record<string, never>): void;
}

/** Ordered host candidates: modern document first, then any deprecated navigator alias. */
export interface ModelContextHostPort {
  candidates(required: Record<string, never>): readonly unknown[];
}

/** Adapts the first installed native surface to Jini's argument-object port. */
export function getAgentModelContext({ host }: { host: ModelContextHostPort }, _optional: Record<string, never> = {}): AgentModelContextLike | undefined {
  for (const value of host.candidates({})) {
    const context = adaptNativeModelContext({ value });
    if (context) return context;
  }
  return undefined;
}
