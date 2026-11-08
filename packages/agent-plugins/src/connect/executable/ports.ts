/** Executable tools consume local ports; the host supplies contribution and approval owners. */
import type { ToolPermissionAuthorizationPort as AuthorizationPort, LegacyToolAuthorizeFn, ToolExecutionContext, ToolMetadata, ToolRegistration, ToolRegistry } from '@jini-ai/core';
import type { SurfaceCardDetail } from '@jini-ai/core/contracts/cards';
import type { HttpClientPort } from '@jini-ai/core/primitives';
import type { AgentPluginLimitResult, AgentPluginStateReader, IssuedTokenMemories } from '../../lifecycle/tools/capabilities.js';
import type { defineAgentPluginToolContribution, LoadedAgentPluginTool } from '../../lifecycle/tools/definition.js';
import type { AgentPluginAdditionalTool, AgentPluginToolProjectionPorts } from '../../lifecycle/tools/projection.js';
import type { AgentPluginToolEffect } from '../../lifecycle/tools/manifest.js';

/** Which connection a call asks for. `connectionRef` is opaque and comes from plugin input. */
export interface AgentPluginConnectionTarget {
  readonly workspaceId: string;
  readonly pluginId: string;
  readonly connectionRef: string;
}

/** Host port over the API-connection service (implemented with the connection lots). It must refuse
 *  a `connectionRef` that the plugin does not own in that workspace, and never return a refresh token. */
export interface AgentPluginConnectionAccess {
  /** The signed-in account, or null when the connection is not connected or not owned. */
  readAccount(required: AgentPluginConnectionTarget, optional?: Record<string, never>): Promise<{ readonly accountId: string; readonly displayName: string } | null>;
  /** A fresh access token; refuses (`account-changed`) when `expectedAccountId` no longer matches. */
  getAccessToken(required: AgentPluginConnectionTarget, optional?: { readonly expectedAccountId?: string }): Promise<string>;
}

/** Optional host store for files a tool hands to the user (e.g. an export). */
export interface AgentPluginArtifactWriter {
  write(required: { readonly workspaceId: string; readonly pluginId: string; readonly name: string; readonly mediaType: string; readonly content: string | Uint8Array }, optional?: Record<string, never>): Promise<{ readonly artifactRef: string }>;
}

/** The limiter shape of `@jini-ai/http-kit`'s `RateLimiter` (Tovu's `createRateLimiter`). */
export interface AgentPluginRateLimiter {
  check(required: { readonly key: string }): Promise<AgentPluginLimitResult>;
}

/** The read-only settings view for one plugin in one workspace (`api-connections/plugin-state.ts`'s `readerFor`). */
export type AgentPluginStateReaderFor = (required: { readonly workspaceId: string; readonly pluginId: string }, optional?: Record<string, never>) => AgentPluginStateReader;

/** The https origins one plugin's connections declare in one workspace (the union of their `apiOrigins`). */
export type AgentPluginApiOriginsFor = (required: { readonly workspaceId: string; readonly pluginId: string }, optional?: Record<string, never>) => Promise<readonly string[]>;

/** Accounts frozen when a call was confirmed, keyed by that call's abort signal (one per execution). */
export interface FrozenConnectionAccounts {
  bind(required: { readonly signal: AbortSignal; readonly accounts: ReadonlyMap<string, string> }, optional?: Record<string, never>): void;
  /** The frozen account id; `null` when the call was frozen but not for this connection; `undefined` when it was never frozen. */
  lookup(required: { readonly signal: AbortSignal | undefined; readonly connectionRef: string }, optional?: Record<string, never>): string | null | undefined;
}


export type AgentPluginProjectionRegistry = AgentPluginToolProjectionPorts['registry'];
export interface AgentPluginExecutableContributionRegistry extends AgentPluginProjectionRegistry {
  list(required: Record<string, never>, optional?: Record<string, never>): readonly { readonly pluginId: string; readonly tools: readonly { readonly name: string; readonly effect?: AgentPluginToolEffect }[] }[];
  subscribe(required: { readonly onChanged: () => void }, optional?: Record<string, never>): () => void;
}
export interface AgentPluginExecutableContributions<Registry extends AgentPluginExecutableContributionRegistry> {
  readonly definition: ReturnType<typeof defineAgentPluginToolContribution>;
  readonly createRegistry: (required: Record<string, never>, optional?: Record<string, never>) => Registry;
  readonly toolIdFor: AgentPluginToolProjectionPorts['toolIdFor'];
  readonly buildRegistrations: (required: {
    readonly contributions: Registry;
    readonly isEnabled: (required: { pluginId: string }) => Promise<boolean>;
    readonly resolveAuth: (required: { pluginId: string; principalId: string }) => Promise<{ access: 'admin'; principalId: string; workspaceId: string }>;
    readonly metadata: ToolMetadata;
  }) => ToolRegistration[];
}
export interface AgentPluginExecutableRuntimeHost {
  readonly loadContributions: (required: { workspaceId: string; definition: ReturnType<typeof defineAgentPluginToolContribution> }, optional: { orderByPluginId?: boolean }) => Promise<{ items: readonly LoadedAgentPluginTool[]; refusals: readonly string[] }>;
  readonly connections: AgentPluginConnectionAccess;
  readonly http: HttpClientPort;
  readonly limiter: AgentPluginRateLimiter;
  readonly artifacts?: AgentPluginArtifactWriter;
  readonly state: AgentPluginStateReaderFor;
  readonly apiOrigins: AgentPluginApiOriginsFor;
  readonly issuedTokens: IssuedTokenMemories;
  readonly frozen?: FrozenConnectionAccounts;
  readonly adminSurfaces?: {
    readonly permission: string;
    loadActionTools(required: { workspaceId: string; authorize: AuthorizationPort; connectionKey: (required: { workspaceId: string; pluginId: string; connectionId: string }) => string }): Promise<readonly AgentPluginAdditionalTool[]>;
  };
}
export type ApplyAgentPluginApproval = (required: { readonly registration: ToolRegistration }, optional: { readonly disclose: (required: { readonly ctx: ToolExecutionContext }) => Promise<readonly SurfaceCardDetail[]> }) => ToolRegistration;
export type AgentPluginApprovalFamily = 'agent-plugin-read' | 'agent-plugin-write' | 'agent-plugin-destructive';
export type ApplyAgentPluginPolicy = (required: { readonly registration: ToolRegistration; readonly family: AgentPluginApprovalFamily }, optional?: Record<string, never>) => ToolRegistration;
export interface AgentPluginDisclosureMessages { readonly withdrawn: string; readonly notConnected: string; readonly accountLabel: string; readonly affectsLabel: string }
export interface AgentPluginExecutableRegistrationRequired<Registry extends AgentPluginExecutableContributionRegistry> {
  readonly registry: ToolRegistry; readonly workspaceId: string; readonly host: AgentPluginExecutableRuntimeHost;
  readonly isActive: (required: { readonly pluginId: string }) => Promise<boolean>;
  readonly authorize: LegacyToolAuthorizeFn; readonly applyApproval: ApplyAgentPluginApproval;
  readonly withExtensionApprovalPolicy: ApplyAgentPluginPolicy;
  readonly contributions: AgentPluginExecutableContributions<Registry>;
  readonly connectionKey: (required: { workspaceId: string; pluginId: string; connectionId: string }) => string;
  readonly readApproval: NonNullable<ToolMetadata['approval']>;
  readonly disclosureMessages: AgentPluginDisclosureMessages;
}
