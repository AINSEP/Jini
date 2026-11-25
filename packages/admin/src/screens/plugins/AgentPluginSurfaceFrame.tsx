import type { AgentPluginSurfacesPort, AgentPluginSurfaceSummary } from "./hooks/agent-plugin-surfaces-port.hooks.js";
import type { useAdminSurfaceFrame as UseAdminSurfaceFrame } from "./hooks/use-admin-surface-frame.hooks.js";

import { type Translate } from "@jini-ai/core/text";
/**
 * @file One plugin-owned admin surface (for example a plugin's "Manage connection" screen) in
 * Jini's sandboxed frame: `sandbox="allow-scripts"` only (never `allow-same-origin`, which with
 * scripts would let the frame lift its own sandbox) and `referrerpolicy="no-referrer"`. Everything
 * the surface does goes through the injected `useAdminSurfaceFrame`'s message gate. Below the frame, the
 * host page offers the sign-in links the server issued for this mount (the frame cannot open popups).
 */

export interface AgentPluginSurfaceFrameProps {
  /** The host-bound frame controller (it supplies the host's theme sources). */
  readonly useAdminSurfaceFrame: (required: Parameters<typeof UseAdminSurfaceFrame>[0] extends infer R ? Omit<R, "themeSources"> : never, optional?: Record<string, never>) => ReturnType<typeof UseAdminSurfaceFrame>;
  readonly pluginId: string;
  readonly surface: AgentPluginSurfaceSummary;
  readonly port: AgentPluginSurfacesPort;
  readonly t: Translate;
}

export function AgentPluginSurfaceFrame({ pluginId, surface, port, t, useAdminSurfaceFrame: useAdminSurfaceFrameHook }: AgentPluginSurfaceFrameProps) {
  const frame = useAdminSurfaceFrameHook({ pluginId, surface, port });
  if (frame.status === "navigated") return <p className="field-hint" role="status">{t("This view left its page and was closed. Close and reopen the plugin to use it again.")}</p>;
  if (frame.status === "failed") return <p className="field-hint" role="alert">{t("Could not open this view. Close and reopen the plugin to try again.")}</p>;
  const { attributes } = frame;
  return (
    <div className="card">
      <iframe
        ref={frame.frameRef}
        src={attributes.src}
        title={attributes.title}
        sandbox={attributes.sandbox}
        referrerPolicy={attributes.referrerPolicy}
        onLoad={frame.onLoad}
        // Sized to the surface's own reported height; 28rem only until the first report arrives.
        style={{ width: "100%", height: frame.height === null ? "28rem" : `${frame.height}px`, border: 0, display: "block" }}
      />
      {frame.signIns.map((link) => (
        <p key={link.authorizationUrl} className="field-hint" role="status">
          {t("Sign-in opens in your browser.")}{" "}
          <a className="btn-primary" href={link.authorizationUrl} target="_blank" rel="noopener noreferrer" onClick={() => frame.onSignInOpened(link)}>
            {t("Continue to sign-in")}
          </a>
        </p>
      ))}
    </div>
  );
}
