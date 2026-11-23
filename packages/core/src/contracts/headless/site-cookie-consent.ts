import type { ConsentState, DeclaredScript, RawContribution, RegionResolver } from '../site/cookie-consent.js';

/** The one switch's payload: present = this engine serves the site. */
export interface SiteCookieConsentDeps {
  /** The last good published mode; without any successful policy read embeds stay inert. */
  embedConsentOff?: () => boolean;
  /** Refresh the construction-time published snapshot after an owner publication. */
  refresh?: () => Promise<void>;
  exportAssets?: () => Promise<readonly string[]>;
  /** Asked once per export, before it renders: a warning when no policy has ever loaded successfully. */
  exportWarning?: () => Promise<string | undefined>;
  /** This site's region readers (configured ingress plugin + legacy header); empty = strict. */
  regionResolvers: () => Promise<readonly RegionResolver[]>;
  /** Data-only modules from active plugins; the browser mounts them through the shared registry. */
  browserPlugins?: () => Promise<readonly RawContribution[]>;
  /** Active plugin declarations and explicit refusal diagnostics, shared with admin readiness. */
  scriptDeclarations?: () => Promise<{ scripts: readonly DeclaredScript[]; problems: readonly string[] }>;
}
/** A same-origin plugin handler (e.g. an analytics adapter's SDK, adapter module and collector). */
export interface ConsentPluginHttp {
  path: string;
  handle(required: { method: string; path: string; body: Uint8Array; contentType: string; analyticsLevel?: ConsentState['analyticsLevel'] }): Promise<{ status: number; body: string | Uint8Array; contentType?: string; cacheControl?: string }>;
}
export interface ConsentPluginContribution { adapter: RawContribution; http?: ConsentPluginHttp }
