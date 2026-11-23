/**
 * @file The visitor-tools policy contract the host owns, as the minimal structural types and one
 * injected bundle (`VisitorToolsHostContract`) the moved management code needs. The host keeps the
 * policy parser, its validation error, the stored setting coordinates, permission and limits; it binds
 * them once and passes the bundle through each moved function's existing deps/args.
 */

export type VisitorToolMode = "auto" | "ask" | "off";
export interface VisitorToolLimits { readonly perIpPerHour: number; readonly perSitePerDay: number }
export interface VisitorToolChoice { readonly mode: VisitorToolMode; readonly limits: VisitorToolLimits }
export interface VisitorToolPolicy { readonly version: 1; readonly tools: Readonly<Record<string, VisitorToolChoice>> }

/** Display copy is additive: older catalogs and unavailable sources can retain their existing copy. */
export interface VisitorToolDescriptor {
  readonly id: string;
  /** Assigned by the host source adapter; plugins cannot claim builtin to bypass publication approval. */
  readonly source: "builtin" | "plugin" | "created" | "unavailable";
  readonly sourceRevision: string;
  readonly title: string;
  readonly description: string;
  readonly displayTitle?: string;
  readonly displayDescription?: string;
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

/** The host's visitor-tools policy contract, bound once by the host and passed as `visitorTools`. */
export interface VisitorToolsHostContract {
  /** Where the policy is stored (`{ namespace, key }`). */
  readonly setting: { readonly namespace: string; readonly key: string };
  /** The dedicated management permission every read and write requires. */
  readonly permission: string;
  readonly defaultLimits: VisitorToolLimits;
  readonly callsPerTurn: number;
  /** The host's validation error: thrown for invalid input, recognised with `instanceof`. */
  readonly ValidationError: new (message: string) => Error;
  /** Require an object, optionally closed to the given keys; throws `ValidationError`. */
  readonly object: (required: { value: unknown; keys?: readonly string[] }) => Record<string, unknown>;
  /** Validate bounded stored JSON or management input; throws `ValidationError`. */
  readonly parsePolicy: (required: { value: unknown }) => VisitorToolPolicy;
  /** The effective choice for one tool under a parsed policy. */
  readonly resolveChoice: (required: { policy: VisitorToolPolicy; toolId: string }) => VisitorToolChoice;
}
