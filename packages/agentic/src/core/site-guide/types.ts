/** Read-only learning contracts. Hosts supply facts; plugins supply prose, never read effects. */
export interface GuideCaller { readonly principalId: string }
export interface GuidePointer {
  readonly label: string;
  readonly tool?: string | undefined;
  readonly href?: string | undefined;
  readonly permissions: readonly string[];
}
export interface GuideWorkflow {
  readonly title: string;
  readonly steps: readonly string[];
  readonly permissions: readonly string[];
}
export interface GuideTopic {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly explanation: string;
  readonly permissions: readonly string[];
  readonly pointers: readonly GuidePointer[];
  readonly workflows: readonly GuideWorkflow[];
}
export interface GuideContribution { readonly pluginId: string; readonly topics: readonly GuideTopic[] }
export interface GuideContributionResult {
  readonly items: readonly GuideContribution[];
  /** Host-local diagnostics; never expose arbitrary loader messages to the model. */
  readonly refusals: readonly string[];
}
export type GuideFact =
  | { readonly status: 'ok'; readonly data: unknown; readonly truncated?: boolean }
  | { readonly status: 'forbidden' | 'unavailable' };
/** Only a permission-scoped, explicitly projected DTO may leave the host adapter. */
export interface SiteFactsPort {
  read(input: { readonly caller: GuideCaller; readonly topics: readonly string[] }, options?: Record<string, never>): Promise<Readonly<Record<string, GuideFact>>>;
}
export interface SiteGuidePorts {
  readonly facts: SiteFactsPort;
  readonly authorize: (input: { readonly caller: GuideCaller; readonly permission: string }, options?: Record<string, never>) => Promise<boolean>;
  readonly loadContributions?: (input: { readonly caller: GuideCaller }, options?: Record<string, never>) => Promise<GuideContributionResult>;
  readonly builtInTopics?: readonly GuideTopic[];
}
export interface GuideTopicView {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly explanation?: string;
  readonly pointers?: readonly Omit<GuidePointer, 'permissions'>[];
  readonly workflows?: readonly Omit<GuideWorkflow, 'permissions'>[];
  readonly source: string;
}
export interface GuideResult {
  readonly operation: 'overview' | 'explain';
  readonly topics: readonly GuideTopicView[];
  readonly facts: Readonly<Record<string, GuideFact>>;
  /** Granted permissions consulted for this result, rather than an inventory of the caller's roles. */
  readonly callerPermissions: readonly string[];
  readonly enrichment: 'ok' | 'unavailable' | 'partial';
}
export interface SiteGuide {
  run(input: { readonly caller: GuideCaller; readonly operation: 'overview' | 'explain'; readonly topic?: string }, options?: Record<string, never>): Promise<GuideResult>;
}
