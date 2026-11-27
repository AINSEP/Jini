import assert from "node:assert/strict";
import { test } from "vitest";
import { EntrySlugConflictError, VersionConflictError } from "../errors.js";
import { TrashAwareInMemoryEntryRepo } from "../repo.trash-aware.memory.js";
import type { EntryRecord } from "../types.js";

const WS = "ws-1";
const NOW = "2026-09-23T00:00:00.000Z";

function entry(id: string, overrides: Partial<EntryRecord> = {}): EntryRecord {
  return { id, workspaceId: WS, type: "recipe", slug: `slug-${id}`, status: "draft", title: id, bodyJson: null, fieldsJson: { ext: { site: {} } }, publishedAt: null, createdAt: NOW, updatedAt: NOW, version: 1, ...overrides };
}

/** A repo whose host hook records the repository it was called with. */
function repoWithRecordedHook() {
  const settled: object[] = [];
  const repo = new TrashAwareInMemoryEntryRepo({ onWriteSettled: ({ repo: written }) => { settled.push(written); } });
  return { repo, settled };
}

test("a successful save calls the hook once with this repository", async () => {
  const { repo, settled } = repoWithRecordedHook();
  await repo.save(entry("e1"));
  assert.deepEqual(settled, [repo]);
  assert.equal(settled[0], repo);
});

test("a REFUSED save (trashed slug holder, version conflict, taken id) does not call the hook: that site is not in a finally", async () => {
  const { repo, settled } = repoWithRecordedHook();
  await repo.save(entry("held"));
  await repo.saveAny({ ...entry("held"), deletedAt: NOW });
  await repo.save(entry("e2"));
  settled.length = 0;
  await assert.rejects(repo.save(entry("other", { slug: "slug-held" })), EntrySlugConflictError);
  await assert.rejects(repo.save(entry("e2", { version: 2 }), { expectedVersion: 7 }), VersionConflictError);
  await assert.rejects(repo.save(entry("e2", { slug: "slug-other" }), { expectedVersion: null }), VersionConflictError);
  assert.equal(settled.length, 0);
});

test("a transaction calls the hook when it resolves and when it rejects", async () => {
  const { repo, settled } = repoWithRecordedHook();
  assert.equal(await repo.transaction({ fn: async () => "ok" }), "ok");
  assert.equal(settled.length, 1, "resolved");
  await assert.rejects(repo.transaction({ fn: async () => { throw new Error("boom"); } }), /boom/);
  assert.equal(settled.length, 2, "rejected");
});

test("saveAny calls the hook for a live row and for a trashed one", async () => {
  const { repo, settled } = repoWithRecordedHook();
  await repo.saveAny({ ...entry("a"), deletedAt: null });
  await repo.saveAny({ ...entry("a"), deletedAt: NOW });
  assert.equal(settled.length, 2);
});

test("hardDelete calls the hook only when it removed a row; a missing id does not", async () => {
  const { repo, settled } = repoWithRecordedHook();
  await repo.saveAny({ ...entry("a"), deletedAt: NOW });
  settled.length = 0;
  await repo.hardDelete({ workspaceId: WS, id: "missing" });
  assert.equal(settled.length, 0, "missing id");
  await repo.hardDelete({ workspaceId: WS, id: "a" });
  assert.equal(settled.length, 1, "removed");
  assert.equal(await repo.findAnyById({ workspaceId: WS, id: "a" }), null);
});

test("a read never calls the hook", async () => {
  const { repo, settled } = repoWithRecordedHook();
  await repo.findById({ workspaceId: WS, id: "none" });
  await repo.findBySlug({ workspaceId: WS, type: "recipe", slug: "none" });
  await repo.listByWorkspace({ workspaceId: WS });
  await repo.findAnyById({ workspaceId: WS, id: "none" });
  assert.equal(settled.length, 0);
});

test("a trashed row is hidden by every read; findAny* shows it with its marker; a live row has a null marker", async () => {
  const { repo } = repoWithRecordedHook();
  await repo.save(entry("live"));
  await repo.saveAny({ ...entry("gone"), deletedAt: NOW });
  assert.equal(await repo.findById({ workspaceId: WS, id: "gone" }), null);
  assert.equal(await repo.findBySlug({ workspaceId: WS, type: "recipe", slug: "slug-gone" }), null);
  assert.deepEqual((await repo.listByWorkspace({ workspaceId: WS })).map((row) => row.id), ["live"]);
  assert.deepEqual((await repo.listByWorkspaceExcludingTypes({ workspaceId: WS, excludeTypes: [] })).map((row) => row.id), ["live"]);
  assert.equal((await repo.findAnyById({ workspaceId: WS, id: "gone" }))?.deletedAt, NOW);
  assert.equal((await repo.findAnyBySlug({ workspaceId: WS, type: "recipe", slug: "slug-gone" }))?.deletedAt, NOW);
  assert.equal((await repo.findAnyById({ workspaceId: WS, id: "live" }))?.deletedAt, null);
});

test("limit applies after trashed rows are dropped, and excluded types are dropped before the limit", async () => {
  const { repo } = repoWithRecordedHook();
  await repo.saveAny({ ...entry("t1"), deletedAt: NOW });
  await repo.save(entry("a"));
  await repo.save(entry("sys", { type: "system" }));
  await repo.save(entry("b"));
  assert.equal((await repo.listByWorkspace({ workspaceId: WS }, { limit: 2 })).length, 2, "two live rows although a trashed row exists");
  const rows = await repo.listByWorkspaceExcludingTypes({ workspaceId: WS, excludeTypes: ["system"], limit: 2 });
  assert.deepEqual(rows.map((row) => row.type), ["recipe", "recipe"]);
  assert.ok(!rows.some((row) => row.id === "t1"));
});

test("every read and hardDelete is scoped to the workspace", async () => {
  const { repo } = repoWithRecordedHook();
  await repo.save(entry("mine"));
  await repo.save(entry("theirs", { workspaceId: "ws-2" }));
  assert.deepEqual((await repo.listByWorkspace({ workspaceId: WS })).map((row) => row.id), ["mine"]);
  assert.equal(await repo.findById({ workspaceId: "ws-2", id: "mine" }), null);
  await repo.hardDelete({ workspaceId: "ws-2", id: "mine" });
  assert.equal((await repo.findById({ workspaceId: WS, id: "mine" }))?.id, "mine");
  await repo.saveAny({ ...entry("trashed"), deletedAt: NOW });
  await repo.hardDelete({ workspaceId: "ws-2", id: "trashed" });
  assert.equal((await repo.findAnyById({ workspaceId: WS, id: "trashed" }))?.deletedAt, NOW);
});

test("a slug held by a trashed row refuses a create with the Trash's message; a save of the trashed row itself is a silent skip", async () => {
  const { repo } = repoWithRecordedHook();
  await repo.saveAny({ ...entry("held"), deletedAt: NOW });
  await assert.rejects(repo.save(entry("other", { slug: "slug-held" })), (error: unknown) => {
    assert.ok(error instanceof EntrySlugConflictError);
    assert.equal(error.message, "an entry with slug 'slug-held' is in the Trash — restore it, or delete it permanently from the Trash, to reuse the slug");
    return true;
  });
  await repo.save(entry("held", { title: "changed" }));
  assert.equal((await repo.findAnyById({ workspaceId: WS, id: "held" }))?.title, "held");
});

test("listPublishedForDisplay: offset 0, 1 and absent; null sort keys first ascending and last descending; ties by id; trashed rows hidden", async () => {
  const { repo } = repoWithRecordedHook();
  const withSite = (id: string, site: Record<string, unknown>, title = id) => entry(id, { status: "published", publishedAt: NOW, title, fieldsJson: { ext: { site } } });
  for (const row of [withSite("ten", { prep: 10 }), withSite("two", { prep: 2 }), withSite("nine", { prep: 9 }), withSite("none", {})]) await repo.save(row);
  const ids = async (query: object) => (await repo.listPublishedForDisplay({ workspaceId: WS, query: { type: "recipe", where: [], sort: { by: "title", dir: "asc" }, limit: 10, ...query } as never })).map((row) => row.id);
  assert.deepEqual(await ids({ sort: { by: { field: "prep" }, dir: "asc" } }), ["none", "two", "nine", "ten"]);
  assert.deepEqual(await ids({ sort: { by: { field: "prep" }, dir: "desc" } }), ["ten", "nine", "two", "none"]);
  assert.deepEqual(await ids({ sort: { by: "title", dir: "asc" } }), ["nine", "none", "ten", "two"]);
  assert.deepEqual(await ids({ sort: { by: "title", dir: "asc" }, offset: 1, limit: 2 }), ["none", "ten"]);
  assert.deepEqual(await ids({ sort: { by: "title", dir: "asc" }, offset: 0, limit: 1 }), ["nine"]);
  await repo.saveAny({ ...withSite("none", {}), deletedAt: NOW });
  assert.deepEqual(await ids({ where: [{ field: "prep", value: 2 }] }), ["two"]);
  assert.equal((await ids({})).includes("none"), false);
  const same = withSite("a", {}, "Same");
  await repo.save(same);
  await repo.save(withSite("b", {}, "Same"));
  assert.deepEqual(await ids({ sort: { by: "title", dir: "asc" } }), ["a", "b", "nine", "ten", "two"]);
  assert.deepEqual(await ids({ sort: { by: "title", dir: "desc" } }), ["two", "ten", "nine", "a", "b"]);
});

test("a versioned save cannot modify a hidden entry even with its actual version", async () => {
  const { repo, settled } = repoWithRecordedHook();
  const hidden = { ...entry("held"), deletedAt: NOW, version: 4 };
  await repo.saveAny(hidden);
  settled.length = 0;
  await assert.rejects(repo.save({ ...hidden, title: "changed", version: 5 }, { expectedVersion: 4 }), {
    message: "expected version 4 for entry 'held', found none",
  });
  assert.equal(await repo.findById({ workspaceId: WS, id: "held" }), null);
  assert.deepEqual(await repo.findAnyById({ workspaceId: WS, id: "held" }), hidden);
  assert.deepEqual(settled, []);
});
