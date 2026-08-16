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
 * dependency on `@jini-ai/ui`. `McpUiHost`/`McpUiToolCallHandler`/`parseUIResource`/`readPreferredFrameSize` still
 * come from `@jini-ai/ui/mcp-ui`, which owns the actual sandboxed-iframe hosting and MCP-UI
 * resource vocabulary — genuinely ui-generic, with real consumers beyond this one component.
 *
 * ## The parent-DOM mirror
 *
 * A surface renders inside a `srcdoc` iframe sandboxed to `allow-scripts` alone (no
 * `allow-same-origin`, deliberately — see `MCP_UI_VIEW_SANDBOX`), which gives it an opaque origin
 * no ancestor document can read into. `page.find_elements` (`@jini-ai/agentic`'s page-control
 * capability) scans the PARENT document only, so no amount of `data-agent-*` tagging inside the
 * frame (see `surfaces/document.ts`'s `renderActions`) makes a surface's pending confirmation, or
 * its buttons' labels, discoverable to it. `readActionPlan` (this component's other new import)
 * gives this component the same `{title, actions}` a surface renders as real buttons, via a typed
 * `_meta` channel rather than scraping HTML — see `MCP_UI_ACTION_PLAN_META_KEY`'s own doc.
 *
 * What this component does with that plan is deliberately narrow: publish a single, `status`-role,
 * DISCOVERY-ONLY region per surface — `page.find_elements` can learn a confirmation is pending and
 * what its buttons are called, but NOTHING here carries a `data-agent-element` handle for an
 * individual action. `page.click` (`dom-page-driver.ts`) does not consult `data-agent-role` at all;
 * it activates whatever a handle resolves to, unconditionally. So there is no such thing as a
 * "safely" clickable mirror button — publishing one at all would let the same live agent that
 * raised the confirmation answer its own dialog, defeating the human gate the surface exists to
 * enforce. That capability may be built deliberately later (the owner has floated letting an agent
 * confirm non-destructive actions, e.g. on a timer) but it is a real policy decision — which tool
 * calls, what gates it, an audit trail — not a default this visibility fix should smuggle in.
 *
 * `aria-hidden="true"` plus `display: none`: the mirror exists purely for a DOM-attribute scanner,
 * never for a human — the real dialog is already visible (and, once resolved, readable) in the
 * iframe right next to it. Without `aria-hidden` a screen-reader user would hear the confirmation's
 * title and button labels announced twice, in slightly different words, once from the live dialog
 * and once from this region — `role="status"` is an implicit `aria-live="polite"` region, so it
 * would self-announce on mount even before being focused. Verified empirically, not assumed, that
 * hiding it this way does not also make it invisible to `find_elements`: that capability never
 * filters its result set by visibility (`dom-page-driver.ts`'s `findElements`), only annotates a
 * `visible` field in per-element STATE when a caller opts into it — see the regression tests added
 * against the real driver in `@jini-ai/agentic`.
 */
import { Fragment, useMemo } from 'react';
import {
  McpUiHost,
  parseUIResource,
  readActionPlan,
  readPreferredFrameSize,
  type McpUiActionPlan,
  type McpUiToolCallHandler,
  type UIResource,
} from '@jini-ai/ui/mcp-ui';
import { registerExtEventRenderer, type ExtEventRenderProps } from '../ext-event-renderer-registry.js';
import { useT } from '../hooks/context.js';

/** The `kind: 'ext'` event name this renderer claims. */
export const MCP_UI_EXT_EVENT_NAME = 'mcp-ui';

export interface McpUiSurfaceCardProps extends ExtEventRenderProps {
  /** Executes a tool a View asked for. Omit and every `tools/call` is refused — visibly, in the dialog. */
  onToolCall?: McpUiToolCallHandler;
  onOpenLink?: (url: string) => void;
  /**
   * Ceiling for a View's self-reported height, forwarded to every `McpUiHost` this card renders.
   * Omit to keep `McpUiHost`'s own `DEFAULT_MAX_HEIGHT` (720px) — a reasonable default for a
   * full-width transcript, but well past what a narrow docked pane can show without excessive
   * scrolling for content taller than its `preferredFrameSize` guess. A host embedding this card in
   * a fixed-width sidebar should pass a cap sized to its own viewport.
   */
  maxHeight?: number;
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

/**
 * Builds a valid `data-agent-element` handle from a surface's `ui://` URI.
 *
 * Handles are `[a-z0-9]+(-[a-z0-9]+)*` (`@jini-ai/agentic`'s `HANDLE_PATTERN`) — narrower than a
 * URI, which carries `:`, `/`, and whatever characters a producer's own id scheme uses. Rather than
 * assume every producer's URI already happens to satisfy that pattern (`agentHandle()` THROWS on a
 * handle that does not, which would take down the whole surface card's render for an otherwise
 * perfectly valid resource), this sanitizes unconditionally: lowercase, collapse every run of
 * disallowed characters to one hyphen, trim the ends. A URI already shaped like
 * `ui://tovu/deployment-execute-static-publish/<uuid>` survives this close to verbatim; this only
 * has teeth for a producer whose id scheme this package has never seen.
 */
function pendingMirrorHandle(uri: string): string {
  const sanitized = uri.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `mcp-ui-pending-${sanitized === '' ? 'surface' : sanitized}`;
}

/** The one label a mirror region carries — what is pending, and what an agent could report or wait on. */
function pendingMirrorLabel(t: ReturnType<typeof useT>, plan: McpUiActionPlan): string {
  const actionLabels = plan.actions.map((action) => action.label).join(', ');
  return t('A confirmation is pending human response: "{title}". Buttons: {actions}.', {
    title: plan.title,
    actions: actionLabels === '' ? t('none') : actionLabels,
  });
}

/**
 * The parent-DOM, discovery-only echo of one surface's pending action plan — see this module's own
 * doc for what it is, why it carries no clickable handle, and why it is hidden from both sighted
 * and screen-reader users. A standalone component (rather than inline JSX in the `.map` below)
 * purely so its narrow job — one `<div>`, a handful of static attributes — reads as a complete,
 * self-contained unit rather than a growing side-branch of `McpUiSurfaceCard`'s own return.
 */
function PendingSurfaceMirror({ uri, plan, t }: { uri: string; plan: McpUiActionPlan; t: ReturnType<typeof useT> }) {
  return (
    <div
      aria-hidden="true"
      style={{ display: 'none' }}
      data-agent-element={pendingMirrorHandle(uri)}
      data-agent-role="status"
      data-agent-label={pendingMirrorLabel(t, plan)}
    />
  );
}

/** Registered against `ext-event-renderer-registry.ts`'s `'mcp-ui'` name — see module doc. */
export function McpUiSurfaceCard({ events, onToolCall, onOpenLink, maxHeight }: McpUiSurfaceCardProps) {
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
        const plan = readActionPlan(resource);
        return (
          <Fragment key={resource.resource.uri}>
            <McpUiHost
              title={resource.resource.uri}
              html={resource.resource.text}
              // The whole document, not its LENGTH. `useMcpUiHost` already defaults `sessionKey` to
              // `html` — exact by construction — and this override replaced that with a digest so
              // coarse that any two documents of equal size under one URI collided: a genuine update
              // (a re-rendered dialog with the same-length body, a swapped confirmation token) reused
              // the previous iframe session, so the handshake never re-ran and the frame kept serving
              // the OLD document's state. The URI stays in the key because it is real identity; the
              // length was never a substitute for content.
              sessionKey={`${resource.resource.uri}:${resource.resource.text}`}
              {...(onToolCall === undefined ? {} : { onToolCall })}
              {...(onOpenLink === undefined ? {} : { onOpenLink })}
              {...(height === undefined || Number.isNaN(height) ? {} : { initialHeight: height })}
              {...(maxHeight === undefined ? {} : { maxHeight })}
            />
            {plan !== undefined && <PendingSurfaceMirror uri={resource.resource.uri} plan={plan} t={t} />}
          </Fragment>
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
 * @param options.maxHeight - See {@link McpUiSurfaceCardProps.maxHeight}. A host with a fixed-width
 * pane (a docked sidebar rather than a full-width transcript) should set this once here instead of
 * accepting the library's full-width-oriented 720px default.
 * @returns An unregister handle, so a test or a hot reload can dispose cleanly.
 */
export function registerMcpUiSurfaceRenderer(
  options: {
    onToolCall?: McpUiToolCallHandler;
    onOpenLink?: (url: string) => void;
    name?: string;
    maxHeight?: number;
  } = {},
): () => void {
  return registerExtEventRenderer(options.name ?? MCP_UI_EXT_EVENT_NAME, (props) => (
    <McpUiSurfaceCard
      {...props}
      {...(options.onToolCall === undefined ? {} : { onToolCall: options.onToolCall })}
      {...(options.onOpenLink === undefined ? {} : { onOpenLink: options.onOpenLink })}
      {...(options.maxHeight === undefined ? {} : { maxHeight: options.maxHeight })}
    />
  ));
}
