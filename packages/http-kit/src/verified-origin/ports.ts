type UUID = string;
import type { VerifiedOrigin } from "./types.js";

export interface VerifiedOriginRequestContext {
  workspaceId: UUID;
  siteId?: UUID;
  locale?: string;
}

export interface RedirectTargetContext {
  workspaceId: UUID;
  siteId?: UUID;
  originKey?: string;
}

export interface EgressTargetContext {
  workspaceId: UUID;
  siteId?: UUID;
}

export interface OriginRegistryPort {

  canonicalOrigin(ctx: VerifiedOriginRequestContext): Promise<VerifiedOrigin>;

  isAllowedRedirectTarget(required: { context: RedirectTargetContext; url: string }): Promise<boolean>;

  isAllowedEgressTarget(required: { context: EgressTargetContext; url: string }): Promise<boolean>;
}

export interface OriginSettingRepoPort {

  findByWorkspaceId(required: { workspaceId: UUID }): Promise<VerifiedOrigin | null>;

  findRedirectAllowlist(required: { workspaceId: UUID }): Promise<string[]>;

  findEgressAllowlist(required: { workspaceId: UUID }): Promise<string[]>;
}
