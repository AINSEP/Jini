/**
 * @module tool-renderer-registry
 *
 * Per-tool renderer registry — ships "as-is" per
 * `ADS-memory/reports/jini-port/recon/r4b-webui-design.md` §2 ("SHIP AS-IS, runtime/tool-renderers.ts").
 * Origin: `apps/web/src/runtime/tool-renderers.ts`'s registration mechanism
 * (verified 0 OD product references — the pure `deriveToolStatus`/
 * `toRenderProps` half of that file already lives in `@jini-ai/chat/core`'s
 * `tools.ts`; this module is only the React-typed registry half chat-core
 * deliberately did not port).
 *
 * The open-design analogue of CopilotKit's `useCopilotAction({ render })`
 * and AG-UI's tool render-prop contract. `<ToolCard>` consults this registry
 * before its own built-in family cards, so a host (or a skill/plugin) can
 * override or extend tool rendering without forking the component.
 */
import type { ReactNode } from 'react';
import type { ToolRenderProps } from '../core/index.js';

/**
 * Tool render callback. Mirrors AG-UI's `({ status, args, result, ... })`
 * render-prop shape.
 *
 * The callback runs inside `<ToolCard>`'s render — it is not mounted as its
 * own component, so it must be hook-free. If you need hooks, return a
 * component element instead: `(props) => <MyHookfulCard {...props} />`.
 *
 * Returning `null`/`undefined`/`false` defers to `<ToolCard>`'s next lookup
 * step (a built-in family card, then the generic fallback).
 */
export type ToolRenderer = (props: ToolRenderProps) => ReactNode;

/** Owned lookup and registration state for one chat tree. */
export interface ToolRendererRegistry {
  register(required: { name: string; renderer: ToolRenderer }): () => void;
  get(required: { name: string }): ToolRenderer | undefined;
  clear(required: Record<string, never>): void;
}

/** Create independent tool renderer state; registrations never leak to another tree.
 * @returns A keyed registry with identity-safe unregister handles.
 * @example const tools = createToolRendererRegistry({}); tools.register({ name: 'Read', renderer });
 */
export function createToolRendererRegistry(_required: Record<string, never> = {}): ToolRendererRegistry {
  const renderers = new Map<string, { renderer: ToolRenderer }>();
  return {
    // Names are case-sensitive; last writer wins. Compare the registration entry rather than
    // the callback: re-registering the same callback still invalidates its old cleanup handle.
    register({ name, renderer }) {
      const entry = { renderer };
      renderers.set(name, entry);
      return () => { if (renderers.get(name) === entry) renderers.delete(name); };
    },
    get({ name }) { return renderers.get(name)?.renderer; },
    clear(_required) { renderers.clear(); },
  };
}

/** Compatibility default for hosts that have not supplied owned state. */
export const defaultToolRendererRegistry = createToolRendererRegistry({});

/**
 * Register a renderer for a tool name in the compatibility default. Returns an unregister handle so
 * tests / hot-reloads can dispose cleanly. Names are matched case-sensitively against
 * `tool_use.name`. Re-registering the same name overwrites — last writer wins.
 */
export function registerToolRenderer(required: { name: string; renderer: ToolRenderer }): () => void {
  return defaultToolRendererRegistry.register(required);
}
export function getToolRenderer(required: { name: string }): ToolRenderer | undefined {
  return defaultToolRendererRegistry.get(required);
}
/** Visible mainly for tests using the compatibility default. */
export function clearToolRenderers(required: Record<string, never>): void {
  defaultToolRendererRegistry.clear(required);
}
