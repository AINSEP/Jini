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
import type { ToolRenderProps } from '@jini-ai/chat/core';

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

const renderers = new Map<string, ToolRenderer>();

/**
 * Register a renderer for a tool name. Returns an unregister handle so
 * tests / hot-reloads can dispose cleanly. Names are matched case-sensitively
 * against `tool_use.name`. Re-registering the same name overwrites — last
 * writer wins.
 */
export function registerToolRenderer(name: string, renderer: ToolRenderer): () => void {
  renderers.set(name, renderer);
  return () => {
    if (renderers.get(name) === renderer) renderers.delete(name);
  };
}

export function getToolRenderer(name: string): ToolRenderer | undefined {
  return renderers.get(name);
}

/** Visible mainly for tests. */
export function clearToolRenderers(): void {
  renderers.clear();
}
