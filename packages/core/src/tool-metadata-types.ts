/** Domain registrations own these declarations; projections never infer risk or authorization. */
export interface ToolApprovalMetadata {
  readonly class: 'read' | 'edit' | 'trash' | 'delete' | 'restore-over-existing' | 'publish' | 'replace-secret' | 'escalation';
  readonly confirmation: 'direct' | 'policy' | 'plan';
  readonly input?: 'human-form';
  /** Host-owned input classification rule, separate from the declared side effects. */
  readonly rule?: string;
}

export interface ToolMetadata<A extends ToolApprovalMetadata = ToolApprovalMetadata> {
  /** Human-facing action name and optional button verb; presentation only, never authority. */
  readonly title?: string;
  /** Plain-language consequence shown before approval; never used to classify or authorize. */
  readonly summary?: string;
  readonly actionVerb?: string;
  /** Installed guidance capabilities needed by a writer; independent of permission and risk. */
  readonly guidanceCapabilities?: readonly string[];
  readonly search?: { readonly keywords?: string; readonly queries?: readonly string[] };
  readonly approval?: A;
  readonly mcpUi?: { readonly redeemable?: boolean; readonly exchangeOnly?: boolean; readonly secretField?: { readonly secret: true } };
}

export type ToolMetadataById<A extends ToolApprovalMetadata = ToolApprovalMetadata> = Readonly<Record<string, ToolMetadata<A>>>;
