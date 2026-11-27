import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemoryEntryRefsRepo } from "../entry-refs.memory.js";
import type { EntryRefRow } from "../ports.js";

const cover: EntryRefRow = { workspaceId: "workspace-a", sourceEntryId: "article", sourceKind: "config-field", fieldPath: "fields.ext.widget.config.media[0]", targetKind: "asset", targetId: "cover" };
const owner = { workspaceId: "workspace-a", sourceEntryId: "article" };
const inOtherWorkspace = { ...cover, workspaceId: "workspace-b" };
const fromOtherSource = { ...cover, sourceEntryId: "news" };

async function populatedRepo(): Promise<InMemoryEntryRefsRepo> {
  const repo = new InMemoryEntryRefsRepo();
  for (const ref of [cover, inOtherWorkspace, fromOtherSource]) {
    await repo.replaceForSource({ workspaceId: ref.workspaceId, sourceEntryId: ref.sourceEntryId, refs: [ref] });
  }
  return repo;
}

test("removing source references preserves the same source in another workspace and other sources in the workspace", async () => {
  const repo = await populatedRepo();
  assert.deepEqual(await repo.findBySource(owner), [cover]);
  await repo.removeBySource(owner);
  await repo.removeBySource(owner);
  assert.deepEqual(await repo.findBySource(owner), []);
  assert.deepEqual(await repo.findByTarget({ workspaceId: "workspace-a", targetKind: "asset", targetId: "cover" }), [fromOtherSource]);
  assert.deepEqual(await repo.findByTarget({ workspaceId: "workspace-b", targetKind: "asset", targetId: "cover" }), [inOtherWorkspace]);
});

test("rebuilding a workspace replaces its entire reference index without touching another workspace", async () => {
  const repo = await populatedRepo();
  const replacement = { ...cover, targetId: "new-cover" };
  await repo.rebuildForWorkspace({ workspaceId: owner.workspaceId, refs: [replacement] });
  assert.deepEqual(await repo.findBySource(owner), [replacement]);
  assert.deepEqual(await repo.findBySource({ workspaceId: "workspace-a", sourceEntryId: "news" }), []);
  assert.deepEqual(await repo.findByTarget({ workspaceId: "workspace-a", targetKind: "asset", targetId: "cover" }), []);
  assert.deepEqual(await repo.findByTarget({ workspaceId: "workspace-b", targetKind: "asset", targetId: "cover" }), [inOtherWorkspace]);
});
