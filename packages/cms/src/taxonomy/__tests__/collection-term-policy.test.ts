import assert from "node:assert/strict";
import { test } from "vitest";
import { ForbiddenError } from "../../core/commands/command.js";
import { authorizeContentEdit, contentEditPermission, createContentTargetPorts, createLiveCollectionTermPolicy } from "../collection-term-policy.js";

// F3.6/F4.4: target requests are pinned; seeded widget collections still cannot carry terms.
test("live collection policy rejects widget types, absent and tombstoned owners, scoped to this workspace", async () => {
  const calls: unknown[] = [];
  const policy = createLiveCollectionTermPolicy({ excludedTypes: new Set(["widget", "widget_area"]), workspaceId: "ws-policy", contentTypeRepo: {
    findByKey: async (p) => { calls.push(p); assert.equal(p.workspaceId, "ws-policy"); return p.key === "missing" ? null : { status: p.key === "old" ? "tombstone" : "active" }; },
  } });
  assert.equal(await policy.taxonomiesFor({ contentType: "widget" }), null);
  assert.equal(await policy.taxonomiesFor({ contentType: "widget_area" }), null);
  assert.deepEqual(calls, []);
  assert.equal(await policy.taxonomiesFor({ contentType: "recipe" }), "all");
  assert.equal(await policy.taxonomiesFor({ contentType: "missing" }), null);
  assert.equal(await policy.taxonomiesFor({ contentType: "old" }), null);
  assert.deepEqual(calls, [{ workspaceId: "ws-policy", key: "recipe" }, { workspaceId: "ws-policy", key: "missing" }, { workspaceId: "ws-policy", key: "old" }]);
});

test("content target lookup routes posts and entries to their workspace-scoped repositories", async () => {
  const calls: unknown[] = [];
  const ports = createContentTargetPorts({ excludedTypes: new Set(["widget", "widget_area"]), workspaceId: "ws-policy",
    postRepo: { findById: async (p) => { calls.push(["post", p]); return { workspaceId: "ws-policy", kind: "page" }; } },
    entryRepo: { findById: async (p) => { calls.push(["entry", p]); return { workspaceId: "ws-policy", type: "recipe" }; } },
    contentTypeRepo: { findByKey: async () => ({ status: "active" }) },
  });
  assert.deepEqual(await ports.contentLookup.resolve({ contentType: "page", contentId: "page-7" }), { workspaceId: "ws-policy", kind: "page" });
  assert.deepEqual(await ports.contentLookup.resolve({ contentType: "recipe", contentId: "entry-9" }), { workspaceId: "ws-policy", kind: "recipe" });
  assert.deepEqual(calls, [["post", { workspaceId: "ws-policy", id: "page-7" }], ["entry", { workspaceId: "ws-policy", id: "entry-9" }]]);
});

test("editing permissions distinguish post/page from collections and a denial carries the exact permission", async () => {
  assert.equal(contentEditPermission({ contentType: "post", postPermission: "content.write", collectionPermission: "admin.collections.manage" }), "content.write");
  assert.equal(contentEditPermission({ contentType: "page", postPermission: "content.write", collectionPermission: "admin.collections.manage" }), "content.write");
  assert.equal(contentEditPermission({ contentType: "recipe", postPermission: "content.write", collectionPermission: "admin.collections.manage" }), "admin.collections.manage");
  const seen: unknown[] = [];
  await assert.rejects(authorizeContentEdit({ workspaceId: "ws-policy", authorize: async (p) => { seen.push(p); return { allowed: false, reason: "no-grant" }; }, principalId: "writer", contentType: "recipe", postPermission: "content.write", collectionPermission: "admin.collections.manage" }), (error) => {
    assert(error instanceof ForbiddenError);
    assert.equal(error.message, "principal 'writer' is not authorized for 'admin.collections.manage' (no-grant)");
    assert.equal(error.permission, "admin.collections.manage");
    assert.equal(error.reason, "no-grant");
    return true;
  });
  assert.deepEqual(seen, [{ principalId: "writer", permission: "admin.collections.manage", workspaceId: "ws-policy" }]);
  await authorizeContentEdit({ workspaceId: "ws-policy", authorize: async () => ({ allowed: true, reason: "matched" }), principalId: "writer", contentType: "page", postPermission: "content.write", collectionPermission: "admin.collections.manage" });
});

// F6.2/F3.6: a transient lookup fault must not be rewritten as a policy denial or cached.
test("collection lookup failures propagate and a later policy call reads recovered state", async () => {
  let fail = true;
  const calls: unknown[] = [];
  const policy = createLiveCollectionTermPolicy({ excludedTypes: new Set(["widget", "widget_area"]), workspaceId: "ws-policy", contentTypeRepo: {
    findByKey: async (params) => {
      assert.deepEqual(params, { workspaceId: "ws-policy", key: "recipe" });
      calls.push(params);
      if (fail) throw new Error("collection store unavailable");
      return { status: "active" };
    },
  } });
  await assert.rejects(policy.taxonomiesFor({ contentType: "recipe" }), { message: "collection store unavailable" });
  fail = false;
  assert.equal(await policy.taxonomiesFor({ contentType: "recipe" }), "all");
  assert.deepEqual(calls, [{ workspaceId: "ws-policy", key: "recipe" }, { workspaceId: "ws-policy", key: "recipe" }]);
});

test('uses host exclusions and editor permissions instead of product defaults', async () => {
  const policy = createLiveCollectionTermPolicy({ workspaceId: 'w', excludedTypes: new Set(['internal']),
    contentTypeRepo: { findByKey: async () => { throw new Error('excluded types must not be looked up'); } } });
  assert.equal(await policy.taxonomiesFor({ contentType: 'internal' }), null);
  assert.equal(contentEditPermission({ contentType: 'page', postPermission: 'host.post', collectionPermission: 'host.collection' }), 'host.post');
  const seen: unknown[] = [];
  await authorizeContentEdit({ workspaceId: 'w', principalId: 'p', contentType: 'recipe', postPermission: 'host.post', collectionPermission: 'host.collection',
    authorize: async request => { seen.push(request); return { allowed: true, reason: 'yes' }; } });
  assert.deepEqual(seen, [{ principalId: 'p', permission: 'host.collection', workspaceId: 'w' }]);
});
