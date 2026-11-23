/**
 * @file A plugin's declarative public-page export, as a host reads it from a parsed manifest.
 *
 * Additive verbatim copy of `AgentPluginExport` and its vocabulary from
 * `@jini-ai/agent-plugins/manifest` (`lifecycle/exports.ts`), plus its structural closure
 * `AdminSurfaceActionSchema` (declared once in `./agent-plugins-admin-surfaces.ts`); agent-plugins keeps its
 * identical declarations, the parsers and its exports until the paired cutover.
 *
 * Declarative public-page exports. Parsing grants no trust and never reads plugin files.
 */

import type { AdminSurfaceActionSchema } from "./agent-plugins-admin-surfaces.js";

/** Matches the CMS consent vocabulary without introducing a dependency on CMS. */
export type AgentPluginExportConsent = 'necessary' | 'functional' | 'analytics' | 'marketing';
export type AgentPluginExportStaticMode = 'full' | 'link-only' | 'fallback-only';
/** Exact https origins an export may reach; the host adds them to the page's content-security policy. */
export interface AgentPluginExportExternalHosts {
  readonly script?: readonly string[];
  readonly frame?: readonly string[];
  readonly connect?: readonly string[];
}
export interface AgentPluginExport {
  readonly template: string;
  readonly props: Extract<AdminSurfaceActionSchema, { type: 'object' }>;
  readonly consent: AgentPluginExportConsent;
  readonly staticExport: AgentPluginExportStaticMode;
  readonly version: number;
  /** Omitted means version 1; hosts accept minVersion <= marker version <= version. */
  readonly minVersion?: number;
  readonly aliases?: readonly string[];
  /** Slot name -> capability declared by this same plugin's provides list. */
  readonly hostLinks?: Readonly<Record<string, string>>;
  readonly styles?: string;
  readonly assets?: Readonly<Record<string, string>>;
  /** Contained .js paths or https URLs on externalHosts.script, loaded in order behind `consent`. */
  readonly scripts?: readonly string[];
  readonly externalHosts?: AgentPluginExportExternalHosts;
  /** String props that must be an https page on one of externalHosts.frame. */
  readonly urlProps?: readonly string[];
}
