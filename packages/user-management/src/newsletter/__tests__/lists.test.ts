/**
 * @file T022 — failing-first tests for `lists.ts` (REQ-08/09, AC-10).
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import { archiveList, ensureDefaultList, saveList, type ListsDeps } from "../lists.js";
import { NewsletterConflictError, NewsletterDefaultListProtectedError, NewsletterListNotFoundError, NewsletterValidationError } from "../errors.js";
import { InMemoryNewsletterListRepo } from "../repo.memory.js";

const WS = "ws-1";
let counter = 0;
const clock = { nowIso: () => "2026-07-13T00:00:00.000Z" };
function makeDeps(): ListsDeps {
  counter = 0;
  return { listRepo: new InMemoryNewsletterListRepo(), clock, ids: { newId: () => `list-${++counter}` } };
}

test("ensureDefaultList: exactly one default list seeded per workspace, idempotent on repeat", async () => {
  const deps = makeDeps();
  const first = await ensureDefaultList({ deps, input: { workspaceId: WS } });
  assert.equal(first.list.isDefault, true);

  const second = await ensureDefaultList({ deps, input: { workspaceId: WS } });
  assert.equal(second.list.id, first.list.id, "idempotent — no second default list created");

  const all = await deps.listRepo.list({ workspaceId: WS });
  assert.equal(all.filter((l) => l.isDefault).length, 1);
});

test("saveList: an empty/whitespace-only name is rejected", async () => {
  const deps = makeDeps();
  await assert.rejects(
    saveList({ deps, input: { workspaceId: WS, name: "   ", slug: "vips" } }),
    (err: unknown) => {
      assert.ok(err instanceof NewsletterValidationError);
      assert.equal(err.message, "name must not be empty");
      return true;
    }
  );
});

test("saveList: an empty/whitespace-only slug is rejected", async () => {
  const deps = makeDeps();
  await assert.rejects(
    saveList({ deps, input: { workspaceId: WS, name: "VIPs", slug: "  " } }),
    (err: unknown) => {
      assert.ok(err instanceof NewsletterValidationError);
      assert.equal(err.message, "slug must not be empty");
      return true;
    }
  );
});

test("saveList: admin-created lists always land isDefault:false", async () => {
  const deps = makeDeps();
  const { list } = await saveList({ deps, input: { workspaceId: WS, name: "VIPs", slug: "vips" } });
  assert.equal(list.isDefault, false);
  assert.equal(list.status, "active");
});

test("saveList: a duplicate slug within the same workspace is rejected with NEWSLETTER_CONFLICT (api.spec.md CREATE_LIST 409)", async () => {
  const deps = makeDeps();
  await saveList({ deps, input: { workspaceId: WS, name: "VIPs", slug: "vips" } });
  await assert.rejects(saveList({ deps, input: { workspaceId: WS, name: "Very Important", slug: "vips" } }), NewsletterConflictError);
});

test("saveList: the same slug is allowed in a DIFFERENT workspace (uniqueness is per-workspace)", async () => {
  const deps = makeDeps();
  await saveList({ deps, input: { workspaceId: WS, name: "VIPs", slug: "vips" } });
  const { list } = await saveList({ deps, input: { workspaceId: "ws-2", name: "VIPs too", slug: "vips" } });
  assert.equal(list.slug, "vips");
});

test("saveList: renaming a list's own slug back to its own current value is not a self-collision", async () => {
  const deps = makeDeps();
  const { list } = await saveList({ deps, input: { workspaceId: WS, name: "VIPs", slug: "vips" } });
  const renamed = await saveList({ deps, input: { workspaceId: WS, id: list.id, name: "VIPs Renamed", slug: "vips" } });
  assert.equal(renamed.list.name, "VIPs Renamed");
  assert.deepEqual(await deps.listRepo.findById({ workspaceId: WS, id: list.id }), { ...list, name: "VIPs Renamed", updatedAt: clock.nowIso() });
});

test("archiveList: the default list rejects archive with NEWSLETTER_DEFAULT_LIST_PROTECTED (AC-10)", async () => {
  const deps = makeDeps();
  const { list: defaultList } = await ensureDefaultList({ deps, input: { workspaceId: WS } });
  await assert.rejects(
    archiveList({ deps, input: { workspaceId: WS, id: defaultList.id } }),
    NewsletterDefaultListProtectedError
  );
});

test("archiveList: a non-default list archives successfully", async () => {
  const deps = makeDeps();
  const { list } = await saveList({ deps, input: { workspaceId: WS, name: "VIPs", slug: "vips" } });
  const archived = await archiveList({ deps, input: { workspaceId: WS, id: list.id } });
  assert.equal(archived.list.status, "archived");
  const expected = { ...list, status: "archived", updatedAt: clock.nowIso() };
  assert.deepEqual(await deps.listRepo.findById({ workspaceId: WS, id: list.id }), expected);
  assert.deepEqual(await deps.listRepo.list({ workspaceId: WS }), [expected]);
});

test("archiveList: unknown list id is rejected", async () => {
  const deps = makeDeps();
  await assert.rejects(archiveList({ deps, input: { workspaceId: WS, id: "nope" } }), NewsletterListNotFoundError);
});

test("saveList: updating a missing list fails without creating a replacement", async () => {
  const deps = makeDeps();
  await assert.rejects(
    saveList({ deps, input: { workspaceId: WS, id: "missing", name: "Missing", slug: "missing" } }),
    (error: unknown) => {
      assert.ok(error instanceof NewsletterListNotFoundError);
      assert.equal(error.message, "list missing was not found");
      return true;
    },
  );
  assert.deepEqual(await deps.listRepo.list({ workspaceId: WS }), []);
});

test("saveList: changing a slug preserves unrelated lists and the edited list's identity", async () => {
  const deps = makeDeps();
  const { list: unrelated } = await saveList({ deps, input: { workspaceId: WS, name: "Readers", slug: "readers" } });
  const { list: original } = await saveList({ deps, input: { workspaceId: WS, name: "VIPs", slug: "vips" } });
  const { list } = await saveList({ deps, input: { workspaceId: WS, id: original.id, name: "Partners", slug: "partners" } });
  const expected = { ...original, name: "Partners", slug: "partners" };
  assert.deepEqual(list, expected);
  assert.deepEqual(await deps.listRepo.findById({ workspaceId: WS, id: original.id }), expected);
  assert.deepEqual(await deps.listRepo.findById({ workspaceId: WS, id: unrelated.id }), unrelated);
});

test("saveList: renaming to another list's slug rejects without changing either list", async () => {
  const deps = makeDeps();
  const { list: first } = await saveList({ deps, input: { workspaceId: WS, name: "Readers", slug: "readers" } });
  const { list: second } = await saveList({ deps, input: { workspaceId: WS, name: "VIPs", slug: "vips" } });
  await assert.rejects(
    saveList({ deps, input: { workspaceId: WS, id: second.id, name: "Renamed", slug: "readers" } }),
    (error: unknown) => {
      assert.ok(error instanceof NewsletterConflictError);
      assert.equal(error.message, "a list with slug 'readers' already exists");
      assert.equal(error.id, first.id);
      return true;
    },
  );
  assert.deepEqual(await deps.listRepo.findById({ workspaceId: WS, id: first.id }), first);
  assert.deepEqual(await deps.listRepo.findById({ workspaceId: WS, id: second.id }), second);
});
