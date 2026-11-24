/** Admin-only visitor catalog/read model. Source owners supply eligibility; policy cannot invent it. */
/**
 * @file The visitor-tool policy vocabulary and the admin catalog/read model a host's visitor-tools
 * management service exposes over HTTP and chat. Types only: the host keeps the policy defaults,
 * the validation and the catalog sources.
 */

/** The per-tool policy a site stores: a mode plus per-IP and per-site call limits. */
export type VisitorToolMode = "auto" | "ask" | "off";
export interface VisitorToolLimits { readonly perIpPerHour: number; readonly perSitePerDay: number }
export interface VisitorToolChoice { readonly mode: VisitorToolMode; readonly limits: VisitorToolLimits }
export interface VisitorToolPolicy { readonly version: 1; readonly tools: Readonly<Record<string, VisitorToolChoice>> }


/** Human-facing English dictionary keys, independent of model-facing descriptions. */
export interface VisitorToolPresentation {
  readonly displayTitle: string;
  readonly displayDescription: string;
}

/** Display copy is additive: older catalogs and unavailable sources can retain their existing copy. */
export interface VisitorToolDescriptor extends Partial<VisitorToolPresentation> {
  readonly id: string;
  /** Assigned by the host source adapter; plugins cannot claim builtin to bypass publication approval. */
  readonly source: "builtin" | "plugin" | "created" | "unavailable";
  readonly sourceRevision: string;
  readonly title: string;
  readonly description: string;
  readonly effect: "read" | "write";
  readonly availability: { readonly available: boolean; readonly reason?: string };
  /** T4/later source owners supply non-secret disclosure, never tokens or headers. */
  readonly publication?: { readonly endpoint: string; readonly credentialId: string; readonly returnedFields: readonly string[] };
}
export interface VisitorToolsView {
  readonly revisionSeq: number;
  /** Unreadable stored policy: every catalog tool is Off; only a site-wide Off reset is accepted. */
  readonly policyState?: "invalid";
  readonly defaults: VisitorToolLimits;
  readonly callsPerTurn: number;
  readonly tools: readonly (VisitorToolDescriptor & VisitorToolChoice)[];
}
export interface VisitorToolsConfigureInput {
  readonly toolId: string;
  readonly expectedRevisionSeq: number;
  readonly mode?: VisitorToolMode;
  readonly limits?: Partial<VisitorToolLimits>;
}
export interface PreparedVisitorToolsChange {
  readonly revisionSeq: number;
  readonly policy: VisitorToolPolicy;
  readonly catalog: readonly VisitorToolDescriptor[];
  readonly changes: readonly { readonly tool: VisitorToolDescriptor; readonly previous: VisitorToolChoice; readonly next: VisitorToolChoice }[];
  readonly requiresApproval: boolean;
}
/** DI boundary shared by HTTP and chat. Prepared changes originate only in the server's prepare(). */
export interface VisitorToolsManagementPort {
  list(required: { callerPrincipalId: string }, optional?: Record<string, never>): Promise<VisitorToolsView>;
  prepare(required: { callerPrincipalId: string; input: unknown }, optional?: Record<string, never>): Promise<PreparedVisitorToolsChange>;
  apply(required: { callerPrincipalId: string; prepared: PreparedVisitorToolsChange }, optional?: Record<string, never>): Promise<VisitorToolsView>;
}
