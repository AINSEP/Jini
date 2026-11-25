/** @file Thin SQL adapter for site consent snapshots, using the host's instrumented kernel. */
import { sql, type RawBuilder } from 'kysely';
import { SiteConsentConflict, type SiteConsentRevision, type SiteConsentStore } from './revisions.js';

type Stored = { id: string; config_json: string; actor_id: string; created_at: string };

/** One workspace's immutable policies and CAS publication; no policy/classification logic.
 * @complexity O(1) indexed reads/writes per operation, bounded config JSON (32 KiB).
 * @example createSiteConsentStore({ kernel, workspaceId: 'site-a' }) */
export function createSiteConsentStore({ kernel, workspaceId, tables }: { kernel: {
  query<Row>(statement: RawBuilder<Row>): Promise<Row[]>;
  execute(statement: RawBuilder<unknown>): Promise<void>;
  lockKey(key: string): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}; workspaceId: string; tables: { revisions: string; heads: string } }, _options = {}): SiteConsentStore {
  /** Keep all row lookups tenant scoped, including pointers read from storage. */
  const revision = async ({ id }: { id: string | null }, _optional = {}): Promise<SiteConsentRevision | null> => {
    if (id === null) return null;
    const [row] = await kernel.query<Stored>(sql`SELECT id, config_json, actor_id, created_at FROM ${sql.table(tables.revisions)} WHERE workspace_id = ${workspaceId} AND id = ${id}`);
    if (!row || row.config_json.length > 32_768) throw new Error('Stored consent revision is unavailable.');
    return { id: row.id, config: JSON.parse(row.config_json), actorId: row.actor_id, createdAt: row.created_at };
  };
  /** Read the head once; immutable revision rows keep both pointers consistent across later publications. */
  const read = async (_input = {}, _optional = {}) => {
    const [head] = await kernel.query<{ draft_id: string | null; published_id: string | null }>(sql`SELECT draft_id, published_id FROM ${sql.table(tables.heads)} WHERE workspace_id = ${workspaceId}`);
    return { draft: await revision({ id: head?.draft_id ?? null }), published: await revision({ id: head?.published_id ?? null }) };
  };
  /** Public context needs no authoring data: one head and at most one bounded publication row.
   * Immutable rows keep this pointer safe across concurrent publication. */
  const readPublished = async (_input = {}, _optional = {}): Promise<SiteConsentRevision | null> => {
    const [head] = await kernel.query<{ published_id: string | null }>(sql`SELECT published_id FROM ${sql.table(tables.heads)} WHERE workspace_id = ${workspaceId}`);
    return revision({ id: head?.published_id ?? null });
  };
  return {
    read,
    readPublished,
    saveDraft: async ({ revision: next, expectedDraftId, signal }, _optional = {}) => kernel.transaction(async () => {
      await kernel.lockKey(`site-consent:${workspaceId}`);
      const state = await read();
      if ((state.draft?.id ?? null) !== expectedDraftId) throw new SiteConsentConflict();
      const config = JSON.stringify(next.config);
      if (config.length > 32_768) throw new Error('Consent configuration exceeds 32 KiB.');
      signal?.throwIfAborted();
      await kernel.execute(sql`INSERT INTO ${sql.table(tables.revisions)} (workspace_id, id, config_json, actor_id, created_at) VALUES (${workspaceId}, ${next.id}, ${config}, ${next.actorId}, ${next.createdAt})`);
      await kernel.execute(sql`INSERT INTO ${sql.table(tables.heads)} (workspace_id, draft_id, published_id) VALUES (${workspaceId}, ${next.id}, NULL) ON CONFLICT (workspace_id) DO UPDATE SET draft_id = ${next.id}`);
    }),
    publish: async ({ draftId, expectedPublishedId, signal }, _optional = {}) => kernel.transaction(async () => {
      await kernel.lockKey(`site-consent:${workspaceId}`);
      const state = await read();
      if (state.draft?.id !== draftId || (state.published?.id ?? null) !== expectedPublishedId) throw new SiteConsentConflict();
      signal?.throwIfAborted();
      await kernel.execute(sql`UPDATE ${sql.table(tables.heads)} SET published_id = ${draftId} WHERE workspace_id = ${workspaceId}`);
    }),
  };
}
