import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useAdminKitValues } from "../../../react/kit.js";
import type { AdminSurfaceFrameAttributes, AdminSurfaceOpenLinkPort, AdminSurfaceThemeToken } from "../../../react/kit-admin-surfaces.js";
import type { AdminSurfaceActionOutcome } from "@jini-ai/core/contracts/site/agent-plugins-admin-surfaces";
import { readAdminTheme, watchAdminTheme } from "../admin-surface-theme.js";
import type { AgentPluginSurfaceActionAnswer, AgentPluginSurfacesPort, AgentPluginSurfaceSummary, HostSignInLink } from "./agent-plugin-surfaces-port.hooks.js";

/**
 * @file The host page's half of one mounted plugin admin surface (Jini's admin-surface protocol):
 * the per-mount nonce, the single `init` (with the server's bootstrap) after the frame's first
 * load (with the host's design tokens, re-sent on every theme change), and the message gate that forwards valid action requests to the server and posts each
 * answer back.
 *
 * Why the "first load only" checks are repeated at post time: the bootstrap and every action
 * answer arrive asynchronously, and if the frame navigated in the meantime its window now holds a
 * different document. Posting there (target `'*'`, the only target an opaque origin allows) would
 * hand that document the bootstrap's short-lived token or an answer meant for the original surface.
 *
 * Sign-in links: the frame is sandboxed without `allow-popups`, so the host page opens a sign-in for
 * it. The only links it ever offers are the ones the server says IT issued while answering this
 * mount's actions (`hostSignIns`), kept per mount, https only, until opened or expired; a URL in the
 * plugin's own result is never opened. The page opens them as a new tab with no opener, which the
 * desktop shell's window policy hands to the system browser (as for every external link).
 *
 * Other external links: a surface may ask to open a link (`open-link`); Jini's gate opens only an
 * https URL whose origin the surface DECLARED (`linkOrigins`, from the digest-checked surfaces file),
 * and only for this mount's frame. The page opens it the same way as a sign-in: a new tab with no
 * opener or referrer on the web, which the desktop shell hands to the system browser.
 */

export type AdminSurfaceFrameStatus = "open" | "navigated" | "failed";

/** Returned to the surface when the host page could not reach the server; never server text. */
const HOST_UNAVAILABLE: AdminSurfaceActionOutcome = {
  ok: false,
  error: { code: "host-unavailable", message: "The admin page could not reach the server. Try again.", retryable: true },
};

export interface AdminSurfaceFrameController {
  /** The frame's `src`, `title`, `sandbox` and `referrerPolicy`, from the protocol library. */
  readonly attributes: AdminSurfaceFrameAttributes;
  readonly frameRef: RefObject<HTMLIFrameElement | null>;
  readonly status: AdminSurfaceFrameStatus;
  readonly onLoad: () => void;
  /** The surface's reported content height in CSS px (clamped by Jini), or null until it reports one. */
  readonly height: number | null;
  /** Host-issued sign-in links for this mount, not yet opened or expired. */
  readonly signIns: readonly HostSignInLink[];
  /** Forgets a link once the person opened it (each attempt is single use). */
  readonly onSignInOpened: (link: HostSignInLink) => void;
}

/** The server's https links only. @complexity O(l). */
function hostLinks(answer: AgentPluginSurfaceActionAnswer): readonly HostSignInLink[] {
  return (answer.hostSignIns ?? []).filter((link) => URL.parse(link.authorizationUrl)?.protocol === "https:");
}

/** The one opener for checked links, hosted and desktop alike (the desktop shell's window policy routes it). */
const openInNewTab: AdminSurfaceOpenLinkPort = ({ url }) => { window.open(url, "_blank", "noopener,noreferrer"); };

/** What the frame receives: the plugin's outcome alone, never the host's links. */
function frameOutcome(answer: AgentPluginSurfaceActionAnswer): AdminSurfaceActionOutcome {
  return answer.ok ? { ok: true, result: answer.result } : { ok: false, error: answer.error };
}

function appendLinks(links: readonly HostSignInLink[]): (current: readonly HostSignInLink[]) => readonly HostSignInLink[] {
  return (current) => [...current, ...links];
}

/**
 * @param required.surface - The listing entry: its `actions` are the client-side early refusal.
 * @complexity O(p) per message in the payload size (Jini's validator), plus one request.
 */
export function useAdminSurfaceFrame(
  required: {
    readonly pluginId: string;
    readonly surface: AgentPluginSurfaceSummary;
    readonly port: AgentPluginSurfacesPort;
    /** The host custom property each shared theme token is read from. */
    readonly themeSources: Readonly<Partial<Record<AdminSurfaceThemeToken, string>>>;
  },
  _optional: Record<string, never> = {},
): AdminSurfaceFrameController {
  const { pluginId, surface, port, themeSources } = required;
  const kit = useAdminKitValues();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const loads = useRef(0);
  const mount = useMemo(() => kit.createAdminSurfaceMount({ surfaceId: surface.id }), [kit, surface.id]);
  const [status, setStatus] = useState<AdminSurfaceFrameStatus>("open");
  const [issued, setIssued] = useState<readonly HostSignInLink[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  /** The frame's window while it still shows the document this mount initialized, else null. */
  const liveFrame = useCallback(() => (loads.current === 1 ? frameRef.current?.contentWindow ?? null : null), []);

  const onLoad = useCallback(() => {
    loads.current += 1;
    // A second load means the frame navigated away from the surface: unmount, never re-init.
    if (loads.current > 1) {
      setStatus("navigated");
      return;
    }
    void port.bootstrap({ pluginId, surfaceId: surface.id }).then(
      (bootstrap) => {
        liveFrame()?.postMessage(kit.adminSurfaceInitMessage({ mountId: mount.mountId }, { bootstrap, theme: readAdminTheme({ readAdminSurfaceTheme: kit.readAdminSurfaceTheme, sources: themeSources }) }), "*");
        setInitialized(true);
      },
      () => setStatus("failed"),
    );
  }, [port, pluginId, surface.id, mount.mountId, liveFrame, kit, themeSources]);

  // The surface follows the admin's look: every theme or light/dark change after init is re-sent.
  useEffect(() => {
    if (!initialized || status !== "open") return undefined;
    return watchAdminTheme({ readAdminSurfaceTheme: kit.readAdminSurfaceTheme, sources: themeSources, onChange: ({ theme }, _optional = {}) => liveFrame()?.postMessage(kit.adminSurfaceThemeMessage({ mountId: mount.mountId, theme }), "*") });
  }, [initialized, status, mount.mountId, liveFrame, kit, themeSources]);

  useEffect(() => {
    if (status !== "open") return undefined;
    const onMessage = (event: MessageEvent) => {
      const frame = liveFrame();
      // No live frame: nothing may match (a null `source` must never equal a missing frame).
      if (frame === null) return;
      // The frame fits its content (no inner scrollbar); a height is cosmetic, so it is never answered.
      const reported = kit.readAdminSurfaceResize({ event, mount: { mountId: mount.mountId, frame } });
      if (reported !== null) {
        setHeight(reported);
        return;
      }
      const record = { mountId: mount.mountId, frame, descriptor: { actions: surface.actions, linkOrigins: surface.linkOrigins ?? [] } };
      // Each gate ignores the other's messages; a link verdict with a response is this mount's open-link.
      void kit.openAdminSurfaceLink({ event, mount: record, openLink: openInNewTab }).then((link) => { if ("response" in link) liveFrame()?.postMessage(link.response, "*"); });
      const verdict = kit.validateAdminSurfaceMessage({ event, mount: record });
      if (!verdict.ok) {
        if ("response" in verdict) frame.postMessage(verdict.response, "*");
        return;
      }
      const { request } = verdict;
      void port.action({ pluginId, surfaceId: surface.id, action: request.action, payload: request.payload })
        .catch((): AgentPluginSurfaceActionAnswer => HOST_UNAVAILABLE)
        .then((answer) => {
          const links = hostLinks(answer);
          if (links.length > 0) setIssued(appendLinks(links));
          liveFrame()?.postMessage(kit.adminSurfaceActionResponse({ request, outcome: frameOutcome(answer) }), "*");
        });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [status, port, pluginId, surface.id, surface.actions, surface.linkOrigins, mount.mountId, liveFrame, kit]);

  const onSignInOpened = useCallback((link: HostSignInLink) => setIssued((current) => current.filter((entry) => entry !== link)), []);
  const signIns = issued.filter((link) => Date.parse(link.expiresAt) > Date.now());
  const attributes = useMemo(() => kit.adminSurfaceFrameAttributes({ src: surface.src, title: surface.title }), [kit, surface.src, surface.title]);
  return { attributes, frameRef, status, onLoad, height, signIns, onSignInOpened };
}
