import { expect, it } from "vitest";
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
