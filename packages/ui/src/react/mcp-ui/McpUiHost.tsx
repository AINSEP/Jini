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
 *
 * It also themes the View: the host's live `--jini-*` theme is written into a Jini-built surface
 * document before it is handed over (`surfaces/host-theme.ts`), and a theme change starts a fresh
 * session with the re-themed document — the same remount any changed document gets.
 */
import { AppRenderer } from '@mcp-ui/client';
import { useRef } from 'react';
import { useHostSurfaceTokens } from './useHostSurfaceTokens.js';
import { resolveFrameHeight, resolveThemedViewSession } from './mcp-ui-host-frame.js';
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
  readonly maxHeight?: number | undefined;
}

/**
 * Renders a View and runs its protocol session.
 *
 * @param props - See {@link McpUiHostProps}.
 */
export function McpUiHost(props: McpUiHostProps) {
  const { title, className } = props;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hostTokens = useHostSurfaceTokens(wrapperRef);
  const { html, sessionKey } = resolveThemedViewSession({ html: props.html, sessionKey: props.sessionKey, hostTokens });
  const host = useMcpUiHost({ ...props, html, sessionKey });
  const height = resolveFrameHeight({ reported: host.size?.height }, props);

  return (
    <div
      ref={wrapperRef}
      className={className}
      data-mcpui-host=""
      data-mcpui-state={host.state}
      aria-label={title}
      // `colorScheme: 'normal'` (inherited by the iframe) keeps the frame see-through on a dark
      // host. Chrome paints an iframe's canvas OPAQUE (white) whenever the frame element's used
      // color-scheme differs from its document's, and a surface declares none -- so under a host's
      // `:root { color-scheme: dark }` every card sat in a white 16px frame (owner, 2026-10-21).
      style={{ display: 'block', width: '100%', height, colorScheme: 'normal' }}
    >
      {hostTokens !== undefined && <AppRenderer
        // Keyed by the session so replacing the document remounts `AppRenderer` — a fresh
        // `AppBridge`, a fresh sandbox iframe, a fresh handshake. `AppRenderer` itself provides no
        // "replace the document in place" mode; remount via `key` is the supported way to start a
        // new session, per `@mcp-ui/client`'s own docs.
        key={sessionKey}
        ref={host.rendererRef}
        {...host.rendererProps}
      />}
    </div>
  );
}
