import { expect, it } from "vitest";
import { SITE_CONSENT_DEFAULTS } from "../config.js";
import { SiteConsentConflict } from "../revisions.js";
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type RawBuilder } from "kysely";
import { createSiteConsentStore } from "../revisions.repo.js";

it("competing publishes serialize and a public read never loads the draft", async () => {
  const db = new Kysely<unknown>({ dialect: {
    createAdapter: () => new PostgresAdapter(), createDriver: () => new DummyDriver(),
    createIntrospector: db => new PostgresIntrospector(db), createQueryCompiler: () => new PostgresQueryCompiler(),
  } });
  const head = { draft_id: "draft", published_id: "published" };
  const readIds: unknown[] = [];
  const locks: string[] = [];
  let tail: Promise<unknown> = Promise.resolve();
  const kernel = {
    async query<Row>(statement: RawBuilder<Row>): Promise<Row[]> {
      const compiled = statement.compile(db);
      if (compiled.sql.includes('"heads"')) return [{ ...head }] as unknown as Row[];
      const id = compiled.parameters[1];
      readIds.push(id);
      return [{ id, config_json: JSON.stringify({ marker: id }), actor_id: "actor", created_at: "stamp" }] as unknown as Row[];
    },
    async execute(statement: RawBuilder<unknown>) {
      const compiled = statement.compile(db);
      head.published_id = String(compiled.parameters[0]);
    },
    async lockKey(key: string) { locks.push(key); },
    transaction<T>(fn: () => Promise<T>): Promise<T> {
      const result = tail.then(fn);
      tail = result.catch(() => {});
      return result;
    },
  };
  const store = createSiteConsentStore({ kernel, workspaceId: "ws", tables: { revisions: "revisions", heads: "heads" } });
  expect((await store.readPublished({}))?.id).toBe("published");
  expect(readIds).toEqual(["published"]);
  const results = await Promise.allSettled([
    store.publish({ draftId: "draft", expectedPublishedId: "published" }),
    store.publish({ draftId: "draft", expectedPublishedId: "published" }),
  ]);
  expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
  expect(locks).toEqual(["site-consent:ws", "site-consent:ws"]);
  await db.destroy();
});

it('keeps an immutable draft separate from the published head, and refuses stale or aborted writes', async () => {
  const db = new Kysely<unknown>({ dialect: {
    createAdapter: () => new PostgresAdapter(), createDriver: () => new DummyDriver(),
    createIntrospector: db => new PostgresIntrospector(db), createQueryCompiler: () => new PostgresQueryCompiler(),
  } });
  type Row = { id: string; config_json: string; actor_id: string; created_at: string };
  const revisions = new Map<string, Row>();
  let head: { draft_id: string; published_id: string | null } | undefined;
  const writes: string[] = [];
  let locked = false;
  const kernel = {
    async query<RowResult>(statement: RawBuilder<RowResult>): Promise<RowResult[]> {
      const { sql, parameters } = statement.compile(db);
      if (parameters[0] !== 'site-4') throw new Error('read escaped the workspace');
      if (sql.includes('FROM "heads"')) return (head ? [{ ...head }] : []) as unknown as RowResult[];
      if (sql.includes('FROM "revisions"')) {
        const row = revisions.get(String(parameters[1]));
        return (row ? [{ ...row }] : []) as unknown as RowResult[];
      }
      throw new Error(`Unexpected query ${sql}`);
    },
    async execute(statement: RawBuilder<unknown>) {
      if (!locked) throw new Error('cannot write before the workspace lock');
      const { sql, parameters } = statement.compile(db);
      if (sql.startsWith('INSERT INTO "revisions"') && parameters[0] === 'site-4') {
        const [, id, json, actor, stamp] = parameters.map(String);
        if (revisions.has(id!)) throw new Error('immutable revisions cannot be replaced');
        revisions.set(id!, { id: id!, config_json: json!, actor_id: actor!, created_at: stamp! });
        writes.push(`revision:${id}`);
      } else if (sql.startsWith('INSERT INTO "heads"') && parameters[0] === 'site-4' && parameters[1] === parameters[2] && revisions.has(String(parameters[1]))) {
        const draft_id = String(parameters[1]);
        head = { draft_id, published_id: head?.published_id ?? null };
        writes.push(`draft:${draft_id}`);
      } else if (sql.startsWith('UPDATE "heads"') && parameters[1] === 'site-4' && head && revisions.has(String(parameters[0]))) {
        head.published_id = String(parameters[0]);
        writes.push(`published:${head.published_id}`);
      } else throw new Error(`Unexpected write ${sql}`);
    },
    async lockKey(key: string) {
      if (key !== 'site-consent:site-4') throw new Error(`Unexpected lock ${key}`);
      locked = true;
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      try { return await fn(); } finally { locked = false; }
    },
  };
  try {
    const store = createSiteConsentStore({ kernel, workspaceId: 'site-4', tables: { revisions: 'revisions', heads: 'heads' } });
    const revision = { id: 'rev-1', config: { ...SITE_CONSENT_DEFAULTS, policyVersion: 'p1' }, actorId: 'owner-4', createdAt: '2026-11-24T00:00:00.000Z' };
    expect(await store.read({})).toEqual({ draft: null, published: null });
    await store.saveDraft({ revision, expectedDraftId: null });
    expect(await store.read({})).toEqual({ draft: revision, published: null });
    expect(await store.readPublished({})).toBeNull();
    await store.publish({ draftId: 'rev-1', expectedPublishedId: null });
    const next = { ...revision, id: 'rev-2', config: { ...revision.config, policyVersion: 'p2' } };
    await expect(store.saveDraft({ revision: next, expectedDraftId: null })).rejects.toBeInstanceOf(SiteConsentConflict);
    await expect(store.saveDraft({ revision: { ...next, config: { ...next.config, customCss: 'x'.repeat(32_769) } }, expectedDraftId: 'rev-1' }))
      .rejects.toThrow('Consent configuration exceeds 32 KiB.');
    const reason = new Error('request cancelled');
    await expect(store.saveDraft({ revision: next, expectedDraftId: 'rev-1', signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(await store.read({})).toEqual({ draft: revision, published: revision });
    await store.saveDraft({ revision: next, expectedDraftId: 'rev-1' });
    expect(await store.read({})).toEqual({ draft: next, published: revision });
    expect(writes).toEqual(['revision:rev-1', 'draft:rev-1', 'published:rev-1', 'revision:rev-2', 'draft:rev-2']);
  } finally { await db.destroy(); }
});
