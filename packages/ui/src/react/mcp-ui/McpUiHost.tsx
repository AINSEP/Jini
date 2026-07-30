/**
 * @module react/mcp-ui/McpUiHost
 *
 * Mounts one MCP-UI View: the sandboxed iframe, the handshake, and the frame sizing that follows
 * the View's own `ui/notifications/size-changed`.
 *
 * Thin on purpose — every protocol decision lives in `useMcpUiHost.ts`, so a consumer needing
 * different chrome (a titled card, a modal, a full-height pane) writes that chrome against the hook
 * rather than forking this.
 */
import { useMcpUiHost, type McpUiHostOptions } from './useMcpUiHost.js';
import { MCP_UI_VIEW_SANDBOX } from '../../features/mcp-ui/protocol.js';

export interface McpUiHostProps extends McpUiHostOptions {
  /** The iframe's accessible name. Required — an unlabelled frame is announced as "frame" and nothing else. */
  readonly title: string;
  readonly className?: string;
  /** Frame height before the View reports its own, and whenever `autoResize` is off. */
  readonly initialHeight?: number;
  /** Follow the View's reported height. Defaults to `true`. */
  readonly autoResize?: boolean;
  /** Ceiling for the followed height, so a View reporting an enormous size cannot push the rest of the page off-screen. */
  readonly maxHeight?: number;
}

const DEFAULT_INITIAL_HEIGHT = 220;
const DEFAULT_MAX_HEIGHT = 720;

/**
 * Renders a View and runs its protocol session.
 *
 * The `sandbox` attribute is {@link MCP_UI_VIEW_SANDBOX} — `allow-scripts`, never
 * `allow-same-origin`. See that constant's own documentation: the spec's example includes
 * `allow-same-origin` because spec Views are served from a separate origin, and a `srcdoc` frame has
 * no separate origin to be isolated to, so copying it would grant the generated document full access
 * to the embedding page.
 *
 * @param props - See {@link McpUiHostProps}.
 */
export function McpUiHost(props: McpUiHostProps) {
  const { title, className, initialHeight = DEFAULT_INITIAL_HEIGHT, autoResize = true, maxHeight = DEFAULT_MAX_HEIGHT } = props;
  const host = useMcpUiHost(props);

  const reported = host.size?.height;
  const height = autoResize && reported !== undefined ? Math.min(Math.max(reported, 1), maxHeight) : initialHeight;

  return (
    <div className={className} data-mcpui-host="" data-mcpui-state={host.state}>
      <iframe
        // Keyed by the session so replacing the document produces a genuinely new frame — and
        // therefore a new `contentWindow`, which is what the Host authenticates messages against.
        // Mutating `srcDoc` in place would leave a frame whose script re-runs while the Host is
        // still in `ready` and refuses its fresh `ui/initialize`.
        key={String(props.sessionKey ?? props.html)}
        ref={host.iframeRef}
        title={title}
        srcDoc={props.html}
        sandbox={MCP_UI_VIEW_SANDBOX}
        style={{ display: 'block', width: '100%', height, border: 0 }}
      />
    </div>
  );
}
