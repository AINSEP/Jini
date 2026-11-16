import type { VerifiedOrigin } from "./types.js";

export interface VerifiedOriginRequestContext {
  workspaceId: string;
  siteId?: string;
  locale?: string;
}

export interface RedirectTargetContext {
  workspaceId: string;
  siteId?: string;
  originKey?: string;
}

export interface EgressTargetContext {
  workspaceId: string;
  siteId?: string;
}

export interface OriginRegistryPort {

  canonicalOrigin(ctx: VerifiedOriginRequestContext): Promise<VerifiedOrigin>;

  isAllowedRedirectTarget(required: { context: RedirectTargetContext; url: string }): Promise<boolean>;

  isAllowedEgressTarget(required: { context: EgressTargetContext; url: string }): Promise<boolean>;
}

export interface OriginSettingRepoPort {

  findByWorkspaceId(required: { workspaceId: string }): Promise<VerifiedOrigin | null>;

  findRedirectAllowlist(required: { workspaceId: string }): Promise<string[]>;

  findEgressAllowlist(required: { workspaceId: string }): Promise<string[]>;
}
