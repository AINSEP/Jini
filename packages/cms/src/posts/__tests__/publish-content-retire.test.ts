import assert from "node:assert/strict";
import { expect, it, vi } from "vitest";
import { InMemoryChangeSetRepo } from "../../core/commands/repo.memory.js";
import { ForbiddenError } from "../../core/index.js";
import { MissingMutationActorError } from "../../core/mutation-actor.js";
import { contentHash } from "../../publish/content/content-hash.js";
import { collectBodyReferences } from "../../publish/content/content-references.js";
import { applyRunActor, createRepoPublishHandler, gatewayDeps } from "../../publish/content/repo-handler.js";
import type { PackedEntity } from "../../publish/transfer/packed-entity.js";
import { prepareTermSync, readTermIds, TERM_SYNC_PERMISSION, withTermIds } from "../../taxonomy/site/publish-term-ids.js";
import { type PostRecord } from "../post.js";
import { PostConflictError, PostNotFoundError } from "@jini-ai/cms/posts/post";
import type { contributePostPublish, packedStateOf, PublishContentDeps } from "../publish-content.js";
import { postRetireMethods } from "../publish-content.retire.js";
import type { RemovePostFn } from "../post-trash.js";
import { NOW, WORKSPACE, postClock, postRepo, postRow, recordingPostOutbox, removeFromPostRepo } from "./post-coverage.fixture.js";

const holder = postRow({ id: "local-page", kind: "page", slug: "story", title: "Destination story", status: "published" });
const incoming: PackedEntity = { id: "incoming", entityType: "post", schemaVersion: 2, hashVersion: 1, contentHash: "source-hash", requiredBlobs: [], state: { slug: "story" } };
const work = { principalId: "release-user", idempotencyKey: "release-2026-11-25" };
const local = { workspaceId: WORKSPACE, id: holder.id };
const holderHash = contentHash({ entityType: "page", state: { title: "Destination story", slug: "story", status: "published" } });
const target = { entityId: "local-page", entityType: "page", entityLabel: "Destination story", hash: holderHash };

function setup(rows: PostRecord[] = [holder]) {
  const repo = postRepo(rows);
  const { outbox, events } = recordingPostOutbox();
  const changeSets = new InMemoryChangeSetRepo([], [], outbox);
  const authorize = vi.fn<NonNullable<PublishContentDeps["authorize"]>>(async ({ workspaceId, principalId, permission }) => ({
    allowed: workspaceId === WORKSPACE && principalId === "release-user" && permission === "content.write", reason: "publish permission",
  }));
  const trashIds = new Set(rows.filter(row => row.deletedAt).map(row => row.id));
  const mark = removeFromPostRepo(repo);
  const remove = vi.fn<RemovePostFn>(async input => {
    const result = await mark(input);
    if (result.ok) trashIds.add(input.id);
    return result;
  });
  const forgetRemoved = vi.fn(async ({ workspaceId, id }: { workspaceId: string; id: string }) => {
    if (workspaceId !== WORKSPACE) throw new Error("Wrong Trash scope");
    trashIds.delete(id);
  });
  let next = 0;
  const deps: PublishContentDeps = { workspaceId: WORKSPACE, clock: postClock, idGen: { newId: () => `command-${++next}` },
    mutationActor: { id: "release-user", kind: "agent" }, changeSets, outbox, authorize,
    ports: { post: { repo, remove, forgetRemoved, reportRollbackError: () => {} } },
  };
  const project = vi.fn<typeof packedStateOf>(async ({ row }) => ({ title: row.title, slug: row.slug, status: row.status }));
  const policy = { contentHash, applyRunActor, createRepoPublishHandler, TERM_SYNC_PERMISSION, withTermIds, readTermIds,
    gatewayDeps, prepareTermSync, collectBodyReferences } satisfies Parameters<typeof contributePostPublish>[0];
  const methods = ({ overrides = {}, omit }: {
    overrides?: Partial<PublishContentDeps>; omit?: "authorize" | "mutationActor";
  } = {}) => {
    const { [omit ?? "backstop"]: _omitted, ...bound } = { ...deps, ...overrides };
    return postRetireMethods({ deps: bound, kind: "post", packedStateOf: project, policy });
  };
  return { repo, project, methods, events, changeSets, trashIds, authorize, remove, forgetRemoved };
}

it("plans a scoped address takeover against the holder's actual kind and content fingerprint", async () => {
  const s = setup([holder, postRow({ id: "foreign", workspaceId: "other", slug: "different" })]);
  expect(await s.methods().planRetire({ entity: incoming })).toEqual(target);
  expect(s.project).toHaveBeenCalledExactlyOnceWith({ row: holder, termPorts: undefined, readTermIds, withTermIds });
  expect(await s.repo.findById(local)).toEqual(holder);
  expect(s.remove).not.toHaveBeenCalled();
});

it.each([
  { name: "missing post port", entity: incoming, rows: [holder], noPort: true },
  { name: "wrong slug type", entity: { ...incoming, state: { slug: 5 } }, rows: [holder], noPort: false },
  { name: "empty slug", entity: { ...incoming, state: { slug: "" } }, rows: [holder], noPort: false },
  { name: "homepage", entity: { ...incoming, state: { slug: "/" } }, rows: [{ ...holder, slug: "/" }], noPort: false },
  { name: "free slug", entity: { ...incoming, state: { slug: "free" } }, rows: [holder], noPort: false },
  { name: "own slug", entity: { ...incoming, id: holder.id }, rows: [holder], noPort: false },
  { name: "incoming id already exists", entity: incoming, rows: [holder, postRow({ id: "incoming" })], noPort: false },
])("does not offer retirement for $name", async ({ entity, rows, noPort }) => {
  const s = setup(rows);
  expect(await s.methods(noPort ? { overrides: { ports: {} } } : {}).planRetire({ entity })).toBeNull();
  expect(s.project).not.toHaveBeenCalled();
  expect(await s.repo.list({ workspaceId: WORKSPACE })).toEqual(rows);
  expect(s.events).toEqual([]);
});

it.each([
  { name: "gateway", options: { omit: "authorize" } },
  { name: "post ports", options: { overrides: { ports: {} } } },
] as const)("refuses retirement when no $name is bound", async ({ options }) => {
  const s = setup();
  await expect(s.methods(options).retire({ target, ...work })).rejects.toThrow(
    "publish-content: post.retire() requires PublishContentDeps.changeSets/authorize/outbox and ports.post.repo/forgetRemoved/remove",
  );
  expect(s.authorize).not.toHaveBeenCalled();
  expect(await s.repo.findById(local)).toEqual(holder);
});

it("refuses a retirement with no trusted actor instead of inventing attribution", async () => {
  const s = setup();
  const result = s.methods({ omit: "mutationActor" }).retire({ target, ...work });
  await expect(result).rejects.toBeInstanceOf(MissingMutationActorError);
  await expect(result).rejects.toThrow("The write by principal 'release-user' names no trusted actor");
  expect(s.authorize).not.toHaveBeenCalled();
  expect(await s.repo.findById(local)).toEqual(holder);
});

it("checks content.write before reading or retiring the address holder", async () => {
  const s = setup();
  s.authorize.mockResolvedValueOnce({ allowed: false, reason: "no grant" });
  const find = vi.spyOn(s.repo, "findById");
  const attempt = s.methods().retire({ target, ...work });
  await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
  await expect(attempt).rejects.toThrow("principal 'release-user' is not authorized for 'content.write' (no grant)");
  expect(s.authorize).toHaveBeenCalledExactlyOnceWith({ workspaceId: WORKSPACE, principalId: "release-user", permission: "content.write",
    entityType: "page", entityId: "local-page" });
  expect(find).not.toHaveBeenCalled();
  expect(s.remove).not.toHaveBeenCalled();
  expect(s.events).toEqual([]);
});

it.each([
  { label: "missing target", rows: [], constructor: PostNotFoundError, message: "page 'local-page' was not found" },
  { label: "changed content", rows: [{ ...holder, title: "Changed since planning", version: 5 }], constructor: PostConflictError,
    message: "the live page at this address changed after this run's plan was built" },
])("does not retire or record a command for $label", async ({ rows, constructor, message }) => {
  const s = setup(rows);
  await assert.rejects(s.methods().retire({ target, ...work }), { constructor, message });
  expect(await s.repo.list({ workspaceId: WORKSPACE })).toEqual(rows);
  expect(await s.changeSets.listByWorkspace({ workspaceId: WORKSPACE })).toEqual([]);
  expect(s.remove).not.toHaveBeenCalled();
  expect(s.events).toEqual([]);
});

it("retires the planned holder with a versioned inverse and restores it forward on undo", async () => {
  const s = setup();
  const result = await s.methods().retire({ target, ...work });
  expect(await s.repo.findBySlug({ workspaceId: WORKSPACE, slug: "story" })).toBeNull();
  expect(await s.repo.findById(local)).toMatchObject({ slug: "story-replaced-20261125", deletedAt: NOW, version: 6 });
  expect(s.trashIds).toEqual(new Set(["local-page"]));
  expect(await s.changeSets.findById({ workspaceId: WORKSPACE, id: result.changeSetId })).toMatchObject({
    changeSet: { summary: "Retire page 'local-page' for publish overwrite", actor: { id: "release-user", kind: "agent" },
      actorId: "release-user", idempotencyKey: "release-2026-11-25" },
    items: [{ entityId: "local-page", entityType: "page", operation: "delete", inversePayload: { deletedAt: null, slug: "story" }, entityVersionAtApply: 6 }],
  });
  await result.undo();
  expect(await s.repo.findById(local)).toEqual({ ...holder, version: 7, updatedAt: NOW });
  expect(s.forgetRemoved).toHaveBeenCalledExactlyOnceWith(local);
  expect(s.trashIds).toEqual(new Set());
  expect(s.events.filter(e => e.name.startsWith("entry.")).map(e => e.id)).toEqual(["local-page-entry.unpublished-6", "local-page-entry.published-7"]);
  expect((await s.repo.listRevisions({ workspaceId: WORKSPACE, postId: "local-page" })).map(r => [r.op, r.seq, r.actorId]))
    .toEqual([["update", 5, "release-user"], ["delete", 6, "release-user"], ["restore", 7, "release-user"]]);
});

it("rolls back a completed retirement if the command ledger cannot record its inverse", async () => {
  const s = setup();
  const failure = new Error("change-set ledger unavailable");
  vi.spyOn(s.changeSets, "insert").mockRejectedValueOnce(failure);
  await expect(s.methods().retire({ target, ...work })).rejects.toBe(failure);
  expect(await s.repo.findById(local)).toEqual({ ...holder, version: 7, updatedAt: NOW });
  expect(await s.changeSets.listByWorkspace({ workspaceId: WORKSPACE })).toEqual([]);
  expect(s.trashIds).toEqual(new Set());
  expect(s.events.filter(e => e.name.startsWith("entry.")).map(e => e.id)).toEqual(["local-page-entry.unpublished-6", "local-page-entry.published-7"]);
});

