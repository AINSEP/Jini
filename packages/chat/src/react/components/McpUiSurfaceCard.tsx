/**
 * @module components/McpUiSurfaceCard
 *
 * Renders MCP-UI Views inline in a chat transcript, fed by a message's `kind: 'ext', name: 'mcp-ui'`
 * events — the same extensibility seam `A2uiSurfaceCard.tsx` uses, and registered the same way: a
 * host calls {@link registerMcpUiSurfaceRenderer} once at module scope and every `ChatPane` that
 * surfaces a matching event renders through it thereafter.
 *
 * Each event's `data` is expected to be an MCP `EmbeddedResource` carrying UI — exactly the object a
 * tool result's `content` array holds, unwrapped. One shape, deliberately: accepting several
 * wrappers would mean guessing which one an unfamiliar producer meant, and guessing wrong renders a
 * blank frame rather than an error.
 *
 * Events sharing a `ui://` URI are one View, not several: a stream may re-send an updated document
 * for a surface already on screen (a confirmation that became a result), so the LAST event for each
 * URI wins while first-appearance order is preserved. Re-keying by URI is also what stops an update
 * from being rendered as a second, duplicate dialog next to the first.
 *
 * Moved here from `@jini-ai/ui`'s `react/mcp-ui/` 2026-08-03, alongside the `@jini-ai/chat`
 * consolidation: this is an ext-event renderer for a chat transcript (chat-domain), not a generic
 * ui primitive, and its sibling `A2uiSurfaceCard.tsx` already lived here. Moving it also removed a
 * real `ui → chat` edge that would otherwise have formed a cycle with `@jini-ai/chat`'s own new
 * dependency on `@jini-ai/ui` — see this package's own report in Tovu's ADS-memory for the full
 * finding. `McpUiHost`/`McpUiToolCallHandler`/`parseUIResource`/`readPreferredFrameSize` still
 * come from `@jini-ai/ui/mcp-ui`, which owns the actual sandboxed-iframe hosting and MCP-UI
 * resource vocabulary — genuinely ui-generic, with real consumers beyond this one component.
 */
import { useMemo } from 'react';
import { McpUiHost, parseUIResource, readPreferredFrameSize, type McpUiToolCallHandler, type UIResource } from '@jini-ai/ui/mcp-ui';
import { registerExtEventRenderer, type ExtEventRenderProps } from '../ext-event-renderer-registry.js';
import { useT } from '../hooks/context.js';

/** The `kind: 'ext'` event name this renderer claims. */
export const MCP_UI_EXT_EVENT_NAME = 'mcp-ui';

export interface McpUiSurfaceCardProps extends ExtEventRenderProps {
  /** Executes a tool a View asked for. Omit and every `tools/call` is refused — visibly, in the dialog. */
  onToolCall?: McpUiToolCallHandler;
  onOpenLink?: (url: string) => void;
}

/** Collapses the event stream to the newest resource per `ui://` URI, in first-appearance order. */
function latestResourcesByUri(events: readonly unknown[]): readonly UIResource[] {
  const byUri = new Map<string, UIResource>();
  for (const event of events) {
    const resource = parseUIResource(event);
    if (resource === undefined) continue;
    byUri.set(resource.resource.uri, resource);
  }
  return [...byUri.values()];
}

/** Registered against `ext-event-renderer-registry.ts`'s `'mcp-ui'` name — see module doc. */
export function McpUiSurfaceCard({ events, onToolCall, onOpenLink }: McpUiSurfaceCardProps) {
  const t = useT();
  const resources = useMemo(() => latestResourcesByUri(events), [events]);

  if (resources.length === 0) {
    // Visible rather than silent: an `ext` event named `mcp-ui` that carries no parseable resource
    // is a producer bug, and a transcript that renders nothing for it hides the bug behind what
    // looks like an ordinary empty turn.
    return (
      <div className="mcpui-surface-card mcpui-surface-card-empty" role="status">
        {t('This MCP-UI event carried no renderable resource.')}
      </div>
    );
  }

  return (
    <div className="mcpui-surface-card">
      {resources.map((resource) => {
        const preferred = readPreferredFrameSize(resource);
        const height = preferred === undefined ? undefined : Number.parseInt(preferred[1], 10);
        return (
          <McpUiHost
            key={resource.resource.uri}
            title={resource.resource.uri}
            html={resource.resource.text}
            sessionKey={`${resource.resource.uri}:${resource.resource.text.length}`}
            {...(onToolCall === undefined ? {} : { onToolCall })}
            {...(onOpenLink === undefined ? {} : { onOpenLink })}
            {...(height === undefined || Number.isNaN(height) ? {} : { initialHeight: height })}
          />
        );
      })}
    </div>
  );
}

/**
 * Registers {@link McpUiSurfaceCard} against the ext-event registry.
 *
 * @param options.onToolCall - The tool executor every View in the transcript calls through. This is
 * the one dependency a host must supply — the card cannot know what "run this tool" means, and
 * hardcoding a transport here would make the component unusable in any host with a different one.
 * @param options.name - Override the claimed event name. Only useful for a host multiplexing two
 * independent MCP-UI streams.
 * @returns An unregister handle, so a test or a hot reload can dispose cleanly.
 */
export function registerMcpUiSurfaceRenderer(
  options: {
    onToolCall?: McpUiToolCallHandler;
    onOpenLink?: (url: string) => void;
    name?: string;
  } = {},
): () => void {
  return registerExtEventRenderer(options.name ?? MCP_UI_EXT_EVENT_NAME, (props) => (
    <McpUiSurfaceCard
      {...props}
      {...(options.onToolCall === undefined ? {} : { onToolCall: options.onToolCall })}
      {...(options.onOpenLink === undefined ? {} : { onOpenLink: options.onOpenLink })}
    />
  ));
}
