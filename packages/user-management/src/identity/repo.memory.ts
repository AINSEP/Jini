import type { ApiKeyRecord, ApiKeyRepoPort } from "./api-key-types.js";

/**
 * @file In-memory adapter for `ApiKeyRepoPort` (ADR-006 rule-of-two, other half in `repo.sqlite.ts`).
 *
 * Purpose:
 * The host's hermetic (in-memory) composition root wires the in-memory identity repos `@jini-ai/cms/identity`
 * ships, but that package has no api-keys port to ship an adapter for (its `INFO.md` scopes API
 * keys out), so this is the in-memory half for the tenth table. Save-is-upsert by `id`, matching
 * the exact semantics every `InMemory*Repo` in that package already has.
 *
 * Architectural role:
 * Test/dev adapter. One `Map` per instance, so each `createRouteDeps()` — and therefore each
 * test's server — gets an isolated store rather than sharing process-wide state.
 */
export class InMemoryApiKeyRepo implements ApiKeyRepoPort {
  private readonly rows = new Map<string, ApiKeyRecord>();

  async findById(required: { workspaceId: string; id: string }): Promise<ApiKeyRecord | null> {
    const row = this.rows.get(required.id);
    return row && row.workspaceId === required.workspaceId ? row : null;
  }

  async findByPrefix(required: { workspaceId: string; prefix: string }): Promise<ApiKeyRecord | null> {
    for (const row of this.rows.values()) {
      if (row.workspaceId === required.workspaceId && row.prefix === required.prefix) return row;
    }
    return null;
  }

  async listByPrincipalId(required: { workspaceId: string; principalId: string }): Promise<ApiKeyRecord[]> {
    return [...this.rows.values()].filter(
      (row) => row.workspaceId === required.workspaceId && row.principalId === required.principalId
    );
  }

  async save(record: ApiKeyRecord): Promise<void> {
    // Match the SQL adapter's terminal revocation even when auth holds an older row snapshot.
    if (this.rows.get(record.id)?.revokedAt) return;
    this.rows.set(record.id, { ...record });
  }
}
