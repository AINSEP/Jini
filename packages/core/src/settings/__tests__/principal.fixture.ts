import type { Principal } from "@jini-ai/core";
import type { SettingsPrincipalLookupPort } from "../principal-lookup.js";
interface FixturePrincipal extends Principal { workspaceId: string; status: "active" | "disabled"; kind?: string; displayName?: string; createdAt?: string }
/** PARITY: membership/status decisions remain in the injected host lookup. */
export class InMemorySettingsPrincipalLookup implements SettingsPrincipalLookupPort {
  constructor(private readonly rows: FixturePrincipal[] = []) {}
  async findActiveById({ workspaceId, id }: { workspaceId: string; id: string }): Promise<Principal | null> {
    const row = this.rows.find(row => row.id === id && row.workspaceId === workspaceId && row.status === "active");
    return row ? { id: row.id } : null;
  }
}
