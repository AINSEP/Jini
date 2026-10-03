type UUID = string;
import type { OriginSettingRepoPort } from "./ports.js";
import { createVerifiedOrigin, type VerifiedOrigin } from "./types.js";

export interface OriginSettingSeed {
  workspaceId: UUID;
  origin: VerifiedOrigin;

  /** Exact-match hosts trusted for cross-origin redirects; independent of third-party egress. */
  redirectAllowlist?: string[];

  /** Exact-match hosts trusted for third-party egress; redirect permission alone does not grant it. */
  egressAllowlist?: string[];
}

/** Seeded read adapter that returns copies of origins and lists to protect stored trust.
 * Reads are O(1) for an origin, O(k) for an allowlist; construction is O(total seed host bytes).
 * @example new InMemoryOriginSettingRepo({ seeds: [{ workspaceId, origin }] });
 */
export class InMemoryOriginSettingRepo implements OriginSettingRepoPort {
  private readonly origins: Map<UUID, VerifiedOrigin>;
  private readonly redirectAllowlists: Map<UUID, string[]>;
  private readonly egressAllowlists: Map<UUID, string[]>;

  constructor({ seeds }: { seeds: readonly OriginSettingSeed[] }) {
    this.origins = new Map();
    this.redirectAllowlists = new Map();
    this.egressAllowlists = new Map();

    for (const seed of seeds) {
      this.origins.set(seed.workspaceId, createVerifiedOrigin(seed.origin));
      this.redirectAllowlists.set(seed.workspaceId, normalizeHostList(seed.redirectAllowlist));
      this.egressAllowlists.set(seed.workspaceId, normalizeHostList(seed.egressAllowlist));
    }
  }

  async findByWorkspaceId({ workspaceId }: { workspaceId: UUID }): Promise<VerifiedOrigin | null> {
    const origin = this.origins.get(workspaceId);
    return origin ? { ...origin } : null;
  }

  async findRedirectAllowlist({ workspaceId }: { workspaceId: UUID }): Promise<string[]> {
    return [...(this.redirectAllowlists.get(workspaceId) ?? [])];
  }

  async findEgressAllowlist({ workspaceId }: { workspaceId: UUID }): Promise<string[]> {
    return [...(this.egressAllowlists.get(workspaceId) ?? [])];
  }
}

function normalizeHostList(hosts: string[] | undefined): string[] {
  return (hosts ?? []).map((host) => host.trim().toLowerCase());
}
