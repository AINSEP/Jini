import type { Principal } from "../principal.js";
/** Resolve only an active principal in the requested workspace. The host owns status and membership policy. */
export interface SettingsPrincipalLookupPort {
  findActiveById(required: { workspaceId: string; id: string }): Promise<Principal | null>;
}
