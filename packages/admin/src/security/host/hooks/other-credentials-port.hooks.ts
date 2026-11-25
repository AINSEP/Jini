import type { AdminExternalMcpServer } from "@jini-ai/core/contracts/site/cms-external-mcp";
import type { AdminExecutionCredential, AdminExecutionCredentialPatch, SiteAssistantCredential, SiteAssistantCredentialPatch } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";
import type { MediaProviderEditPatch as MediaProviderFields } from "../../../react/kit-media-providers.js";
import type { AdminMediaProviderMap } from "../../../screens/media/api/media-api.js";

/**
 * @file What `useOtherCredentials` needs from the outside world, as an interface rather than a
 * direct `lib/api` import — same `useX(dependencies)` / `useWiredX()` shape
 * `access-tokens-port.hooks.ts` uses for Tier 1. One method group per Tier-2 store
 * (`rules.ts`'s `OTHER_CREDENTIAL_STORES`), every one of them a thin bind onto an `api.*` call that
 * ALREADY exists and already backs a real settings screen — this page adds no new HTTP surface here
 * either, only a second reader (and, for three of the four, a second writer) of the same endpoints.
 *
 * Deliberately not one generic `get`/`set`/`remove` trio: the four stores return genuinely
 * different shapes (a single write-only credential view, a provider-keyed map, a server list), and a generic signature would just move that difference into a
 * runtime `unknown` cast at every call site — the same reasoning `AccessTokensPort` gives for keeping
 * `publish`/`sourceControl` as two flat method groups instead of one.
 */
export interface OtherCredentialsPort {
  getSiteAssistantCredential(): Promise<{ data: SiteAssistantCredential }>;
  setSiteAssistantCredential(patch: SiteAssistantCredentialPatch, optional?: Record<string, never>): Promise<{ data: SiteAssistantCredential }>;
  deleteSiteAssistantCredential(): Promise<{ data: SiteAssistantCredential }>;

  getAdminByokCredential(): Promise<{ data: AdminExecutionCredential }>;
  setAdminByokCredential(patch: AdminExecutionCredentialPatch, optional?: Record<string, never>): Promise<{ data: AdminExecutionCredential }>;
  deleteAdminByokCredential(): Promise<{ data: AdminExecutionCredential }>;

  getMediaProviders(): Promise<AdminMediaProviderMap>;
  /** The host's LIVE provider catalog body (the one the Media tab's External Providers cards read), so a
   *  provider contributed at runtime by a plugin reads with its human label rather than its raw id. */
  getMediaProviderCatalog(): Promise<{ providers?: unknown } | null | undefined>;
  /** Merges ONE provider's fields into its own stored row; an omitted `apiKey`/`baseUrl`/`model` keeps
   *  the stored value, and no other provider is named. Deliberately not the whole map: a map built from
   *  this page's snapshot re-sends every other provider as it was at load, undoing a newer save from
   *  another window, and deletes any provider missing from that snapshot. */
  patchMediaProvider(required: { providerId: string; fields: MediaProviderFields }, optional?: Record<string, never>): Promise<AdminMediaProviderMap>;
  /** Deletes exactly the named provider's stored credentials — deletion is only ever this explicit
   *  request, never inferred from a provider missing in a map. */
  removeMediaProvider(required: { providerId: string }, optional?: Record<string, never>): Promise<AdminMediaProviderMap>;

  listExternalMcpServers(): Promise<{ servers: AdminExternalMcpServer[] }>;
  deleteExternalMcpServer(required: { serverId: string }, optional?: Record<string, never>): Promise<{ removed: boolean; restartRequired: boolean }>;
}
