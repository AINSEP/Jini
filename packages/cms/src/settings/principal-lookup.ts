import type { Principal } from "@jini-ai/core";
/** Resolve only an active principal in the requested workspace. The host owns status and membership policy. */
export interface SettingsPrincipalLookupPort {
  findActiveById(required: { workspaceId: string; id: string }): Promise<Principal | null>;
}
