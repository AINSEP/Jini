import { expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { sql } from "kysely";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { postRevisionRefProbes } from "../revision-refs.js";
import { bindRevisionThinning, revisionThinningApprovalHandler } from "../revision-thinning.js";
import { createApprovalHandler, type ToolExecutionContext } from "@jini-ai/core";

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

it("approval card raised before any revision delete; decline deletes nothing", async () => {
  const binding = { preview: vi.fn(async () => ({ ids: ["old"], count: 1, previewToken: "preview" })),
    apply: vi.fn(async () => ({ deleted: ["old"], kept: [] })) };
  let confirmed = false;
  const askHuman = vi.fn(async () => {
    expect(binding.apply).not.toHaveBeenCalled();
    return confirmed ? { confirmed: true as const } : { confirmed: false as const, reason: "declined" as const };
  });
  const thinningCard = vi.fn(() => ({ toolId: "post_thin_revisions", errorCode: "POST", title: "Thin", details: [], confirmLabel: "Delete" }));
  const surfaces = { surfaceExchanges: { open: vi.fn(), deliver: vi.fn(), findTypedAnswerTarget: vi.fn(), size: vi.fn() } };
  const handler = revisionThinningApprovalHandler({ binding, surfaces, workspaceId: "w", thinningCard,
    approvalToolHandler: (required, optional) => createApprovalHandler({
      prepare: required.prepare,
      describe: ({ ctx, prepared }) => ({ ask: optional.ask({ prepared }), description: required.describe({ ctx, prepared }) }),
      askHuman, run: required.run, notConfirmed: () => ({ thinned: false }),
    }),
  });
  const ctx: ToolExecutionContext = { executionId: "execution", principal: { id: "owner" }, run: { id: "run" }, signal: new AbortController().signal,
    input: { postId: "post", kind: "post", before: "2026-03-01" } };
  expect(await handler(ctx)).toEqual({ thinned: false });
  expect(binding.apply).not.toHaveBeenCalled();
  expect(thinningCard).toHaveBeenCalledWith(expect.objectContaining({ prepared: { scope: { workspaceId: "w", postId: "post", kind: "post" }, count: 1, previewToken: "preview" } }));
  confirmed = true;
  expect(await handler(ctx)).toEqual({ thinned: true, deleted: ["old"], kept: [] });
  expect(binding.apply).toHaveBeenCalledWith({ principal: "owner", scope: { workspaceId: "w", postId: "post", kind: "post" }, previewToken: "preview", confirm: true }, {});
  expect(askHuman).toHaveBeenCalledTimes(2);
});

it("undo references keep only matching workspace, entity and before-or-after revision identities", async () => {
  const kernel = sqliteKernel<unknown>({ source: new Database(":memory:") });
  try {
    await kernel.execute(sql`CREATE TABLE change_sets (id TEXT,workspace_id TEXT,status TEXT)`);
    await kernel.execute(sql`CREATE TABLE change_set_items (id TEXT,change_set_id TEXT,entity_id TEXT,before_revision_id TEXT,after_revision_id TEXT,inverse_payload_json TEXT)`);
    await kernel.execute(sql`INSERT INTO change_sets VALUES ('settled','w','reverted'), ('elsewhere','other','applied')`);
    await kernel.execute(sql`INSERT INTO change_set_items VALUES
      ('one','settled','page','before','after',NULL), ('two','settled','other-page','wrong-page',NULL,NULL),
      ('three','elsewhere','page','wrong-workspace',NULL,NULL)`);
    const { undoRefs } = postRevisionRefProbes({ kernel });
    const scope = { workspaceId: "w", postId: "page", kind: "page" };
    const referenced = (id: string) => undoRefs({ scope, revision: { id, seq: 2, recordedAt: "2026-01-01", restoredFrom: null } });
    expect(await referenced("before")).toBe(true);
    expect(await referenced("after")).toBe(true);
    expect(await referenced("wrong-page")).toBe(false);
    expect(await referenced("wrong-workspace")).toBe(false);
    expect(await referenced("absent")).toBe(false);
  } finally { await kernel.close(); }
});

it("legacy snapshots default to post, and thinning stops at an equal-cutoff snapshot", async () => {
  const kernel = sqliteKernel<unknown>({ source: new Database(":memory:") });
  try {
    await kernel.execute(sql`CREATE TABLE post_revisions (workspace_id TEXT,post_id TEXT,id TEXT,seq INTEGER,recorded_at TEXT,restored_from TEXT,state_json TEXT)`);
    await kernel.execute(sql`INSERT INTO post_revisions VALUES
      ('w','legacy','old',1,'2026-01-01',NULL,'{}'), ('w','legacy','cutoff',2,'2026-03-01',NULL,'{}'),
      ('w','legacy','clock-skew',3,'2026-02-01',NULL,'{}')`);
    const authorize = vi.fn<Parameters<typeof bindRevisionThinning>[0]["authorize"]>(async () => {});
    const binding = bindRevisionThinning({ kernel, authorize,
      postRevisionLockKey: ({ postId }) => postId, clock: () => Date.parse("2026-11-25"),
      publishedRefs: async () => false, restoreRefs: async () => false, undoRefs: async () => false,
      previewStore: { put: () => ({ token: "token", deadline: 100 }), take: () => null },
    });
    const scope = { workspaceId: "w", postId: "legacy", kind: "post" };
    await expect(binding.preview({ principal: "owner", before: "2026-03-01", scope: { ...scope, kind: "page" } }))
      .rejects.toThrow("Choose one workspace and one post or page.");
    await expect(binding.preview({ principal: "owner", before: "2026-03-01", scope: { ...scope, postId: "missing" } }))
      .rejects.toThrow("Choose one workspace and one post or page.");
    expect(authorize).not.toHaveBeenCalled();
    await expect(binding.preview({ principal: "owner", before: "2026-12-01", scope }))
      .rejects.toThrow("Choose a past date (YYYY-MM-DD) to thin revisions recorded before it.");
    expect(await binding.preview({ principal: "owner", before: "2026-03-01", scope }))
      .toEqual({ ids: ["old"], count: 1, previewToken: "token" });
    expect(authorize.mock.calls).toEqual([[{ principal: "owner", scope }], [{ principal: "owner", scope }]]);
  } finally { await kernel.close(); }
});

it("only a matching published revision or a pending inverse protects the exact live version it references", async () => {
  const kernel = sqliteKernel<unknown>({ source: new Database(":memory:") });
  try {
    await kernel.execute(sql`CREATE TABLE posts (workspace_id TEXT,id TEXT,status TEXT,version INTEGER)`);
    await kernel.execute(sql`CREATE TABLE change_sets (id TEXT,workspace_id TEXT,status TEXT)`);
    await kernel.execute(sql`CREATE TABLE change_set_items (id TEXT,change_set_id TEXT,entity_id TEXT,before_revision_id TEXT,after_revision_id TEXT,inverse_payload_json TEXT)`);
    await kernel.execute(sql`INSERT INTO posts VALUES ('w','page','published',7), ('elsewhere','page','draft',3)`);
    await kernel.execute(sql`INSERT INTO change_sets VALUES ('pending','w','waiting'), ('settled','w','discarded')`);
    await kernel.execute(sql`INSERT INTO change_set_items VALUES
      ('one','pending','page',NULL,NULL,'{"version":2}'),
      ('two','pending','page',NULL,NULL,NULL),
      ('three','settled','page',NULL,NULL,'{"version":3}'),
      ('four','pending','page',NULL,NULL,'{"version":"4"}')`);
    const { publishedRefs, restoreRefs } = postRevisionRefProbes({ kernel });
    const scope = { workspaceId: "w", postId: "page", kind: "page" };
    const revision = (seq: number) => ({ id: `revision-${seq}`, seq, recordedAt: "2026-01-01", restoredFrom: null });
    expect(await publishedRefs({ scope, revision: revision(7) })).toBe(true);
    expect(await publishedRefs({ scope, revision: revision(6) })).toBe(false);
    expect(await publishedRefs({ scope: { ...scope, workspaceId: "elsewhere" }, revision: revision(3) })).toBe(false);
    expect(await publishedRefs({ scope: { ...scope, workspaceId: "missing" }, revision: revision(7) })).toBe(false);
    expect(await restoreRefs({ scope, revision: revision(2) })).toBe(true);
    expect(await restoreRefs({ scope, revision: revision(3) })).toBe(false);
    expect(await restoreRefs({ scope, revision: revision(4) })).toBe(false);
    expect(await restoreRefs({ scope, revision: revision(6) })).toBe(true);
  } finally { await kernel.close(); }
});

it("SQL thinning deletes the eligible prefix but stops when a surviving revision restores from the next candidate", async () => {
  const kernel = sqliteKernel<unknown>({ source: new Database(":memory:") });
  try {
    await kernel.execute(sql`CREATE TABLE post_revisions (workspace_id TEXT,post_id TEXT,id TEXT,seq INTEGER,recorded_at TEXT,restored_from TEXT,state_json TEXT)`);
    await kernel.execute(sql`INSERT INTO post_revisions VALUES
      ('w','p','old',1,'2026-01-01',NULL,'{"kind":"page"}'),
      ('w','p','protected',2,'2026-01-02',NULL,'{"kind":"page"}'),
      ('w','p','middle',3,'2026-01-03',NULL,'{"kind":"page"}'),
      ('w','p','new',4,'2026-01-04','protected','{"kind":"page"}'),
      ('other','p','old',1,'2026-01-01',NULL,'{"kind":"page"}'),
      ('w','other','old',1,'2026-01-01',NULL,'{"kind":"page"}')`);
    let stored: Parameters<Parameters<typeof bindRevisionThinning>[0]["previewStore"]["put"]>[0] | undefined;
    const publishedRefs = vi.fn<Parameters<typeof bindRevisionThinning>[0]["publishedRefs"]>(async () => false);
    const binding = bindRevisionThinning({ kernel, authorize: async () => {},
      postRevisionLockKey: ({ postId }) => postId, clock: () => Date.parse("2026-11-25"),
      publishedRefs, restoreRefs: async () => false, undoRefs: async () => false,
      previewStore: {
        put: (input) => { stored = input; return { token: "preview", deadline: 100 }; },
        take: (input) => {
          if (!stored || stored.scope !== input.scope || stored.principal !== input.principal || input.token !== "preview") return null;
          const { payload } = stored;
          stored = undefined;
          return { payload, deadline: 100 };
        },
      },
    });
    const scope = { workspaceId: "w", postId: "p", kind: "page" };
    expect(await binding.preview({ principal: "owner", scope, before: "2026-02-01" }))
      .toEqual({ ids: ["old", "protected", "middle", "new"], count: 4, previewToken: "preview" });
    expect(await binding.apply({ principal: "owner", scope, previewToken: "preview", confirm: true }))
      .toEqual({ deleted: ["old"], kept: [{ id: "protected", reason: "isRestoredFrom" }] });
    expect(publishedRefs.mock.calls).toEqual([
      [{ scope, revision: { id: "old", seq: 1, recordedAt: "2026-01-01", restoredFrom: null } }, {}],
      [{ scope, revision: { id: "protected", seq: 2, recordedAt: "2026-01-02", restoredFrom: null } }, {}],
    ]);
    expect(await kernel.query(sql`SELECT workspace_id,post_id,id FROM post_revisions WHERE id='old' ORDER BY workspace_id`)).toEqual([
      { workspace_id: "other", post_id: "p", id: "old" }, { workspace_id: "w", post_id: "other", id: "old" },
    ]);
    expect(await kernel.query(sql`SELECT id FROM post_revisions WHERE workspace_id='w' AND post_id='p' ORDER BY seq`))
      .toEqual([{ id: "protected" }, { id: "middle" }, { id: "new" }]);
  } finally { await kernel.close(); }
});

it("rejects a nonexistent calendar day instead of previewing a silently normalized cutoff", async () => {
  const kernel = sqliteKernel<unknown>({ source: new Database(":memory:") });
  try {
    await kernel.execute(sql`CREATE TABLE post_revisions (workspace_id TEXT,post_id TEXT,id TEXT,seq INTEGER,recorded_at TEXT,restored_from TEXT,state_json TEXT)`);
    await kernel.execute(sql`INSERT INTO post_revisions VALUES ('w','p','one',1,'2026-02-28',NULL,'{"kind":"post"}')`);
    const put = vi.fn<Parameters<typeof bindRevisionThinning>[0]["previewStore"]["put"]>(() => ({ token: "preview", deadline: 100 }));
    const binding = bindRevisionThinning({ kernel, postRevisionLockKey: ({ postId }) => postId,
      authorize: async () => {}, clock: () => Date.parse("2026-11-25"),
      publishedRefs: async () => false, restoreRefs: async () => false, undoRefs: async () => false,
      previewStore: { put, take: () => null },
    });
    const scope = { workspaceId: "w", postId: "p", kind: "post" };
    await expect(binding.preview({ principal: "owner", scope, before: "2026-02-30" }))
      .rejects.toThrow("Choose a past date (YYYY-MM-DD) to thin revisions recorded before it.");
    expect(put).not.toHaveBeenCalled();
  } finally { await kernel.close(); }
});

it("a failed thinning preview surfaces its safe input message before any approval or deletion", async () => {
  const binding = { preview: vi.fn<ReturnType<typeof bindRevisionThinning>["preview"]>(),
    apply: vi.fn<ReturnType<typeof bindRevisionThinning>["apply"]>() };
  const askHuman = vi.fn(async () => ({ confirmed: true as const }));
  const surfaces = { surfaceExchanges: { open: vi.fn(), deliver: vi.fn(), findTypedAnswerTarget: vi.fn(), size: vi.fn() } };
  const handler = revisionThinningApprovalHandler({ binding, surfaces, workspaceId: "w",
    thinningCard: () => { throw new Error("unexpected approval card"); },
    approvalToolHandler: (required, optional) => createApprovalHandler({
      prepare: required.prepare, describe: ({ ctx, prepared }) => ({ ask: optional.ask({ prepared }), description: required.describe({ ctx, prepared }) }),
      askHuman, run: required.run, notConfirmed: () => ({ thinned: false }),
    }),
  });
  const ctx: ToolExecutionContext = { executionId: "exec", principal: { id: "owner" }, run: { id: "run" },
    signal: new AbortController().signal, input: { postId: "p", kind: "page", before: "garbage" } };
  binding.preview.mockRejectedValueOnce(new Error("Choose a past date"));
  await expect(handler(ctx)).rejects.toThrow("Choose a past date");
  binding.preview.mockRejectedValueOnce("backend status");
  await expect(handler(ctx)).rejects.toThrow("Revision thinning refused.");
  expect(askHuman).not.toHaveBeenCalled();
  expect(binding.apply).not.toHaveBeenCalled();
  expect(binding.preview.mock.calls).toEqual(Array.from({ length: 2 }, () => [
    { principal: "owner", scope: { workspaceId: "w", postId: "p", kind: "page" }, before: "garbage" }, {},
  ]));
});
