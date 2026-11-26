import { expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { sql } from "kysely";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { postRevisionRefProbes } from "../revision-refs.js";
import { bindRevisionThinning } from "../revision-thinning.js";

it("an unreadable inverse retains the revision under the append/thin fence", async () => {
  const kernel = sqliteKernel<unknown>({ source: new Database(":memory:") });
  try {
    await kernel.execute(sql`CREATE TABLE posts (workspace_id TEXT,id TEXT,status TEXT,version INTEGER)`);
    await kernel.execute(sql`CREATE TABLE post_revisions (workspace_id TEXT,post_id TEXT,id TEXT,seq INTEGER,recorded_at TEXT,restored_from TEXT,state_json TEXT)`);
    await kernel.execute(sql`CREATE TABLE change_sets (id TEXT,workspace_id TEXT,status TEXT)`);
    await kernel.execute(sql`CREATE TABLE change_set_items (id TEXT,change_set_id TEXT,entity_id TEXT,before_revision_id TEXT,after_revision_id TEXT,inverse_payload_json TEXT)`);
    await kernel.execute(sql`INSERT INTO posts VALUES ('w','post','draft',4)`);
    await kernel.execute(sql`INSERT INTO post_revisions VALUES ('w','post','old',1,'2026-01-01',NULL,'{"kind":"post"}'), ('w','post','new',3,'2026-02-01',NULL,'{"kind":"post"}')`);
    await kernel.execute(sql`INSERT INTO change_sets VALUES ('change','w','applied')`);
    await kernel.execute(sql`INSERT INTO change_set_items VALUES ('item','change','post',NULL,NULL,'not-json')`);
    const lock = vi.spyOn(kernel, "lockKey");
    let payload: Record<string, unknown> | null = null;
    const binding = bindRevisionThinning({ kernel: kernel as unknown as Parameters<typeof bindRevisionThinning>[0]["kernel"],
      ...postRevisionRefProbes({ kernel: kernel as unknown as Parameters<typeof postRevisionRefProbes>[0]["kernel"] }),
      postRevisionLockKey: ({ workspaceId, postId }) => `post_revisions:${workspaceId}:${postId}`, clock: () => Date.parse("2026-11-25"), authorize: async () => {},
      previewStore: { put: ({ payload: value }) => { payload = value; return { token: "token", deadline: 100 }; }, take: () => { const value = payload; payload = null; return value ? { payload: value, deadline: 100 } : null; } },
    });
    const scope = { workspaceId: "w", postId: "post", kind: "post" };
    const preview = await binding.preview({ principal: "owner", scope, before: "2026-03-01" });
    expect(await binding.apply({ principal: "owner", scope, previewToken: preview.previewToken, confirm: true })).toEqual({ deleted: [], kept: [{ id: "old", reason: "isRestoreTarget" }] });
    expect(lock).toHaveBeenCalledWith("post_revisions:w:post");
    expect(await kernel.query(sql`SELECT id FROM post_revisions ORDER BY seq`)).toEqual([{ id: "old" }, { id: "new" }]);
  } finally { await kernel.close(); }
});
