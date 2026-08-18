/**
 * @module react/mcp-ui/McpUiHost
 *
 * Mounts one MCP-UI View through the real `@mcp-ui/client` `AppRenderer` — the sandboxed iframe, the
 * handshake, and the frame sizing that follows the View's own `ui/notifications/size-changed` are
 * all `AppRenderer`'s job now; this component supplies the chrome (title, class, height clamping)
 * around it. See `useMcpUiHost.ts`'s module doc for what this swap changed and why.
 *
 * Thin on purpose, same as before — every protocol decision lives in `useMcpUiHost.ts`, so a
 * consumer needing different chrome writes that chrome against the hook rather than forking this.
 */
import { AppRenderer } from '@mcp-ui/client';
import { useMcpUiHost, type McpUiHostOptions } from './useMcpUiHost.js';

export interface McpUiHostProps extends McpUiHostOptions {
  /** The frame's accessible name — forwarded to `AppRenderer`'s `hostInfo`-independent wrapper `<div>`; the iframe itself has no `title` attribute in `@mcp-ui/client`'s own markup, so this labels the wrapper instead. */
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
 * @param props - See {@link McpUiHostProps}.
 */
export function McpUiHost(props: McpUiHostProps) {
  const { title, className, initialHeight = DEFAULT_INITIAL_HEIGHT, autoResize = true, maxHeight = DEFAULT_MAX_HEIGHT } = props;
  const host = useMcpUiHost(props);

  const reported = host.size?.height;
  const height = autoResize && reported !== undefined ? Math.min(Math.max(reported, 1), maxHeight) : initialHeight;

  return (
    <div
      className={className}
      data-mcpui-host=""
      data-mcpui-state={host.state}
      aria-label={title}
      style={{ display: 'block', width: '100%', height }}
    >
      <AppRenderer
        // Keyed by the session so replacing the document remounts `AppRenderer` — a fresh
        // `AppBridge`, a fresh sandbox iframe, a fresh handshake. `AppRenderer` itself provides no
        // "replace the document in place" mode; remount via `key` is the supported way to start a
        // new session, per `@mcp-ui/client`'s own docs.
        key={String(props.sessionKey ?? props.html)}
        ref={host.rendererRef}
        {...host.rendererProps}
      />
    </div>
  );
}
