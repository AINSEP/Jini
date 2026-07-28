/**
 * @module ext-event-renderer-registry
 *
 * Per-name renderer registry for `AgentEvent`'s `kind: 'ext'` escape hatch — the sibling of
 * `tool-renderer-registry.ts`, which does the same job for `tool_use`/`tool_result` pairs.
 *
 * `kind: 'ext'` exists precisely for host-specific event kinds chat-core doesn't know about (its
 * own doc names `live_artifact`/`plugin_candidate` as examples). Before this module, `MessageRow`
 * silently dropped every `ext` event — nothing rendered them. This registry is what lets a host
 * (or a protocol package like `@jini-ai/a2ui`) claim a `name` and render every event carrying it,
 * inline in the transcript, the same extensibility shape `registerToolRenderer` already gives
 * tool calls.
 *
 * Unlike a tool renderer (one `tool_use`/`tool_result` pair per row), an ext-event renderer
 * receives every event sharing its `name` for the whole message, in arrival order — some
 * protocols (A2UI's `createSurface` → `updateComponents` → ... sequence) are a stream a single
 * snapshot can't represent; the renderer owns folding that sequence into whatever live state it
 * needs (e.g. by feeding each one through a stateful interpreter).
 */
import type { ReactNode } from 'react';

/** Render-prop payload for one `name` group of `kind: 'ext'` events belonging to a message. */
export interface ExtEventRenderProps {
  name: string;
  /** Every matching event's `data`, in arrival order. Never empty. */
  events: readonly unknown[];
  /** Whether the owning run is still streaming — more events with this `name` may still arrive. */
  runStreaming: boolean;
  runSucceeded: boolean;
  /** The owning message's `ChatMessage.runId`, if known — a renderer that needs to send something back to this specific run (e.g. an A2UI action) needs this; omitted (`undefined`) for a message with no run association. */
  runId: string | undefined;
}

/**
 * Ext-event render callback. Runs inline during `MessageRow`'s render — hook-free, like
 * `ToolRenderer`. Return a component element (`(props) => <MyStatefulCard {...props} />`) if you
 * need hooks/local state (e.g. a memoized interpreter instance).
 *
 * Returning `null`/`undefined`/`false` renders nothing for this group — there is no built-in
 * fallback card the way `ToolCard` has one, since an unrecognized `ext` name has no generic
 * rendering that makes sense (unlike an unrecognized tool, which can always fall back to a
 * name+JSON card).
 */
export type ExtEventRenderer = (props: ExtEventRenderProps) => ReactNode;

const renderers = new Map<string, ExtEventRenderer>();

/**
 * Register a renderer for an ext-event `name`. Returns an unregister handle so tests / hot-reloads
 * can dispose cleanly. Re-registering the same name overwrites — last writer wins.
 */
export function registerExtEventRenderer(name: string, renderer: ExtEventRenderer): () => void {
  renderers.set(name, renderer);
  return () => {
    if (renderers.get(name) === renderer) renderers.delete(name);
  };
}

export function getExtEventRenderer(name: string): ExtEventRenderer | undefined {
  return renderers.get(name);
}

/** Visible mainly for tests. */
export function clearExtEventRenderers(): void {
  renderers.clear();
}
