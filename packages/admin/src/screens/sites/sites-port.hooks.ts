import type { AdminLocalSiteAction, AdminCreatedSite, AdminCreatedSiteAgentPluginTokens, AdminSiteActivation, AdminSitesSnapshot, AdminTokenSignInPlugin } from "@jini-ai/core/contracts/site/admin-sites";

/**
 * @file What the host's sites controller hook needs from the outside world, as an interface rather
 * than a direct API-client import — the `useX(dependencies)` / `useWiredX()` split the host's
 * assistant-chats port documents and every other admin feature follows.
 *
 * One port for all three routes rather than one per operation: they read and write the same
 * `sites/` resource, and a test double for one is a double for the resource.
 *
 * `siteRowState`/`activationOutlook`/`siteNameErrorKey` (the host's sites rules) are deliberately
 * NOT here — they are pure rules with no I/O, and per the pattern a hook imports rules directly
 * rather than having them injected.
 */
export interface SitesPort {
  openSite?(required: { url: string }, optional?: Record<string, never>): void;
  manageLocalSite?(input: { name: string; action: AdminLocalSiteAction; confirmed?: boolean; checked?: boolean }, optional?: Record<string, never>): Promise<unknown>;
  listSites(): Promise<AdminSitesSnapshot>;
  createSite(input: { name: string; adminPassword?: string; agentPluginTokens?: Record<string, string> }, optional?: Record<string, never>): Promise<{ site: AdminCreatedSite; agentPluginTokens?: AdminCreatedSiteAgentPluginTokens }>;
  listTokenSignInPlugins(): Promise<{ plugins: AdminTokenSignInPlugin[] }>;
  activateSite(required: { name: string }, optional?: Record<string, never>): Promise<AdminSiteActivation>;
}
