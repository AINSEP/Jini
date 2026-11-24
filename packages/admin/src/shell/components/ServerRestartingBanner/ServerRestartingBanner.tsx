import type {
  useServerConnectionBanner,
  ServerConnectionBannerText,
  ServerConnectionStatusPort,
} from "./hooks/use-server-connection-status.hooks.js";

/** Required: the host's reconnect store, its banner copy per status, and the status hook (the host passes
 *  `useServerConnectionBanner` from `./hooks/use-server-connection-status.hooks`; hooks arrive as props). */
export interface ServerRestartingBannerProps {
  reconnect: ServerConnectionStatusPort;
  text: ServerConnectionBannerText;
  useServerConnectionBannerHook: typeof useServerConnectionBanner;
}

/** A thin top banner while the API is restarting (2026-10-05, S3). Logic: `useServerConnectionBanner`.
 *  Styles: `server-restarting-banner.css` beside this file, imported by the host. */
export function ServerRestartingBanner(props: ServerRestartingBannerProps) {
  // The status hook is a required prop, called through `props` (never imported or defaulted).
  const { status, text } = props.useServerConnectionBannerHook({ reconnect: props.reconnect, text: props.text });
  if (!text) return null;
  return (
    <div className={`jini-server-restarting-banner jini-server-restarting-banner--${status}`} role="status" aria-live="polite">
      {text}
    </div>
  );
}
