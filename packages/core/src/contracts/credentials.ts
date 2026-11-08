/** @agent-note Types only. The runtime parts come from the host; this area usually from `@jini-ai/agent-plugins`. */



/** Extra public connection metadata, entered directly on the secure card. */
export interface PluginCredentialField {
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
  readonly required?: boolean;
}


/** One plugin-declared key card, already resolved to the saved row it fills. */
export interface PluginCredentialCard {
  /** Declaring installed plugin, supplied by the trusted contribution loader. */
  readonly pluginId?: string;
  /** Provider id the assistant passes as `target` (e.g. a mail provider's id). */
  readonly providerId: string;
  /** API credential label, or the connection name for a domain-owned save. */
  readonly label: string;
  /** Explicit ownership of this API card's exact label; conflicting plugins are refused at merge. */
  readonly ownedApiLabel?: string;
  readonly category: string;
  readonly baseUrl: string;
  readonly title: string;
  readonly intro?: string;
  readonly helpUrl?: string;
  readonly helpLabel?: string;
  /** Hint under the key field, e.g. which access the key needs. */
  readonly keyHint?: string;
  /** Plain-text purposes for people and the assistant; never selects or authorizes a key in code. */
  readonly usedFor?: readonly string[];
  readonly fields?: readonly PluginCredentialField[];
  /** Optional read-only GET before sealing; absolute HTTPS on the declared baseUrl origin. */
  readonly probeUrl?: string;
  readonly additionalHosts?: readonly string[];
  /** Absent preserves the original mail/API save path. `provider-settings` saves a provider plugin's
   *  declared settings (saveTarget = that plugin's id; see provider-settings-card.ts). */
  readonly saveKind?: "api" | "publish-host" | "source-control" | "agent-plugin-token" | "oauth" | "provider-settings";
  readonly saveTarget?: string;
  /** Permissions explained on a hosted sign-in card; never grants authority itself. */
  readonly permissions?: string;
}
