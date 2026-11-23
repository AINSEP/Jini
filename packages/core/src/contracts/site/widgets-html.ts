/**
 * @file The host-facing port and admitted-export shape behind CMS's HTML plugin-export embeds
 * (`@jini-ai/cms/widgets/html`). Rendering, substitution and fragment validation stay in cms; these
 * types sit in core so a host's plugin runtime can implement the port without depending on cms.
 */

/**
 * Visitor-consent category an export is gated on. Restated here because core cannot import cms's
 * `CONSENT_CATEGORIES` value (contracts/consent-category.ts); keep the two unions identical.
 */
export type PluginExportConsentCategory = 'necessary' | 'functional' | 'analytics' | 'marketing';

/** Host-prepared, admitted export. The host owns enablement, aliases, schema validation,
 * static-export policy, contained file reads, and public host-link readiness. No secrets belong here.
 * `props` must be the schema-validated marker props; `host` contains only declared public values.
 */
export interface PluginExportTemplate {
  readonly plugin: string;
  readonly component: string;
  readonly version: number;
  readonly minVersion?: number;
  readonly consent: PluginExportConsentCategory;
  readonly template: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly host?: Readonly<Record<string, unknown>>;
  /** Exact https origins a whole `{{props.x}}` URL slot may name; also what admits an iframe. */
  readonly frameHosts?: readonly string[];
  /** The site's consent is off, so a gated frame loads at once rather than waiting for a choice. */
  readonly consentOff?: boolean;
  /** The export ships scripts, so its template may hand them values through data attributes. */
  readonly scriptData?: boolean;
}

/** CMS knows no plugin lifecycle. Unavailable, invalid, or unsupported exports return undefined.
 * Diagnostics are host-owned and must only be exposed to an authenticated editor audience.
 */
export interface PluginExportsPort {
  resolve(required: { config: Readonly<Record<string, unknown>>; workspaceId: string }, optional?: Record<string, never>): Promise<PluginExportTemplate | undefined>;
}
