import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemoryMenuRepo, InMemoryNavLocationBindingRepo, MenuConflictError, MenuNotFoundError, type NavMenuEntry  } from "../../index.js";
import type { MenuRepoPort } from "../../index.js";
import { MenuVersionConflictError } from "../../index.js";
import { importMenuEntity } from "../import-menu.js";
import type { DomainEvent, OutboxPort } from "@jini-ai/core/contracts/events";

const NOW = "2026-10-01T12:00:00.000Z";
function menu(overrides: Partial<NavMenuEntry> = {}): NavMenuEntry {
  return { id: "incoming", workspaceId: "destination", slug: "nav", title: "Incoming", status: "published",
    doc: { type: "menu", version: 1, items: [] }, locations: [], updatedAt: "2026-09-01T00:00:00.000Z", version: 4, ...overrides };
}
function harness() {
  const repo = new InMemoryMenuRepo({});
  const bindingRepo = new InMemoryNavLocationBindingRepo({});
  const events: DomainEvent[] = [];
  let seq = 0;
  const deps = { repo, bindingRepo, clock: { nowIso: () => NOW, nowMs() { return Date.parse(this.nowIso()); } }, idGen: { newId: () => `event-${++seq}` },
    outbox: { enqueue: async (event: DomainEvent) => { events.push(structuredClone(event)); } } as OutboxPort };
  return { deps, events };
}

test("import removes a dropped location even when its binding was already absent", async () => {
  const { deps, events } = harness();
  await deps.repo.save(menu({ locations: ["missing-binding"] }));
  const result = await importMenuEntity({ deps, input: { workspaceId: "destination", record: menu(), expectedVersion: 4 } });
  assert.deepEqual(result.menu.locations, []);
  assert.deepEqual(result.displacedMenus, []);
  assert.equal(await deps.bindingRepo.findByLocation({ workspaceId: "destination", locationKey: "missing-binding" }), null);
  assert.deepEqual(events.map(event => event.name), ["navigation.menu.updated"]);
  assert.equal((await deps.repo.findById({ workspaceId: "destination", id: "incoming" }))?.version, 5);
});

test("import still enforces insert-if-absent when its own identity appears during the slug lookup", async () => {
  const { deps, events } = harness();
  const record = menu();
  const findBySlug = deps.repo.findBySlug.bind(deps.repo);
  deps.repo.findBySlug = async request => {
    await deps.repo.save({ ...record, title: "Concurrent create" });
    return findBySlug(request);
  };
  await assert.rejects(importMenuEntity({ deps, input: { workspaceId: "destination", record } }), MenuVersionConflictError);
  assert.equal((await deps.repo.findById({ workspaceId: "destination", id: record.id }))?.title, "Concurrent create");
  assert.deepEqual(events, []);
});

// F4.4/F6.3: each OCC guard alone can reject; deleting it would overwrite or create a row.
const REFUSALS = {
  "create-existing": { type: MenuConflictError, message: "menu 'incoming' already exists at this destination (version 4) but was published as new" },
  "update-missing": { type: MenuNotFoundError, message: "menu 'incoming' was not found at this destination" },
  "stale-update": { type: MenuConflictError, message: "menu 'incoming' was modified concurrently (expected version 3, found 4)" },
  "slug-collision": { type: MenuConflictError, message: "slug 'occupied' already exists at this destination" },
} as const;
for (const scenario of ["create-existing", "update-missing", "stale-update", "slug-collision"] as const) {
  test(`import refuses ${scenario} before any row, binding or event changes`, async () => {
    const { deps, events } = harness();
    if (scenario !== "update-missing") await deps.repo.save(menu());
    if (scenario === "slug-collision") await deps.repo.save(menu({ id: "holder", slug: "occupied" }));
    await deps.bindingRepo.upsert({ workspaceId: "destination", locationKey: "header", menuId: "neighbor", boundAt: NOW });
    const before = await deps.repo.list({ workspaceId: "destination" });
    const record = menu({ workspaceId: "source", title: "Overwritten", slug: scenario === "slug-collision" ? "occupied" : "nav", locations: ["header"] });
    const expectedVersion = scenario === "create-existing" ? undefined : scenario === "stale-update" ? 3 : 4;
    const refusal = REFUSALS[scenario];
    await assert.rejects(importMenuEntity({ deps, input: { workspaceId: "destination", record, ...(expectedVersion === undefined ? {} : { expectedVersion }) } }),
      (error: unknown) => error instanceof Error && error.constructor === refusal.type && error.message === refusal.message);
    assert.deepEqual(await deps.repo.list({ workspaceId: "destination" }), before);
    assert.deepEqual(await deps.bindingRepo.findByLocation({ workspaceId: "destination", locationKey: "header" }),
      { workspaceId: "destination", locationKey: "header", menuId: "neighbor", boundAt: NOW });
    assert.deepEqual(events, []);
  });
}

function recordSlugLookups(repo: InMemoryMenuRepo): string[] {
  const slugLookups: string[] = [];
  const findBySlug = repo.findBySlug.bind(repo);
  repo.findBySlug = async (request) => { slugLookups.push(request.slug); return findBySlug(request); };
  return slugLookups;
}

test("an update that keeps its slug never looks the slug up", async () => {
  const { deps } = harness();
  await deps.repo.save(menu());
  const slugLookups = recordSlugLookups(deps.repo);
  await importMenuEntity({ deps, input: { workspaceId: "destination", record: menu({ title: "Renamed" }), expectedVersion: 4 } });
  assert.deepEqual(slugLookups, []);
});

test("an update that changes its slug looks the new slug up once and keeps the row's id", async () => {
  const { deps } = harness();
  await deps.repo.save(menu());
  const slugLookups = recordSlugLookups(deps.repo);
  const result = await importMenuEntity({ deps, input: { workspaceId: "destination", record: menu({ slug: "renamed" }), expectedVersion: 4 } });
  assert.deepEqual(slugLookups, ["renamed"]);
  assert.deepEqual([result.menu.id, result.menu.slug, result.menu.version], ["incoming", "renamed", 5]);
});

test("import drops only its own old bindings, retaining another menu's reassigned location", async () => {
  const { deps, events } = harness();
  await deps.repo.save(menu({ locations: ["footer", "sidebar", "header"] }));
  for (const [locationKey, menuId] of [["footer", "incoming"], ["sidebar", "neighbor"], ["header", "incoming"]] as const) {
    await deps.bindingRepo.upsert({ workspaceId: "destination", locationKey, menuId, boundAt: "old-time" });
  }
  const result = await importMenuEntity({ deps, input: { workspaceId: "destination", record: menu({ workspaceId: "source", version: 99, locations: ["header"] }), expectedVersion: 4 } });
  assert.deepEqual(result.menu, menu({ updatedAt: NOW, version: 5, locations: ["header"] }));
  assert.deepEqual(await deps.repo.findById({ workspaceId: "destination", id: "incoming" }), result.menu);
  assert.equal(await deps.bindingRepo.findByLocation({ workspaceId: "destination", locationKey: "footer" }), null);
  assert.deepEqual(await deps.bindingRepo.findByLocation({ workspaceId: "destination", locationKey: "sidebar" }),
    { workspaceId: "destination", locationKey: "sidebar", menuId: "neighbor", boundAt: "old-time" });
  assert.deepEqual(events, [
    { id: "event-1", name: "navigation.menu.updated", occurredAt: NOW, aggregateId: "incoming", workspaceId: "destination", payload: { menuId: "incoming", slug: "nav" } },
    { id: "event-2", name: "navigation.location.assigned", occurredAt: NOW, aggregateId: "incoming", workspaceId: "destination", payload: { locationKey: "header", menuId: "incoming" } },
  ]);
});

test("import repairs an orphan binding and clones the incoming tree before saving", async () => {
  const { deps, events } = harness();
  await deps.bindingRepo.upsert({ workspaceId: "destination", locationKey: "header", menuId: "missing", boundAt: NOW });
  // The doc's items are readonly; this local handle is what the test mutates after the import.
  const home = { id: "home", label: "Home", target: { kind: "url" as const, href: "https://example.test/" } };
  const record = menu({ workspaceId: "source", locations: ["header"], doc: { type: "menu", version: 1, items: [home] } });
  const result = await importMenuEntity({ deps, input: { workspaceId: "destination", record } });
  assert.deepEqual(result.displacedMenus, []);
  home.label = "Source changed";
  assert.equal(result.menu.doc.items[0]!.label, "Home");
  const stored = await deps.repo.findById({ workspaceId: "destination", id: "incoming" });
  assert.equal(stored?.doc.items[0]!.label, "Home");
  assert.equal(stored?.version, 1);
  assert.equal(stored?.workspaceId, "destination");
  assert.equal((await deps.bindingRepo.findByLocation({ workspaceId: "destination", locationKey: "header" }))?.menuId, "incoming");
  assert.deepEqual(events.map(({ name, payload }) => ({ name, payload })), [
    { name: "navigation.menu.created", payload: { menuId: "incoming", slug: "nav" } },
    { name: "navigation.location.assigned", payload: { locationKey: "header", menuId: "incoming" } },
  ]);
});

test("import rejects an invalid tree before saving rows or changing bindings and events", async () => {
  const { deps, events } = harness();
  await deps.bindingRepo.upsert({ workspaceId: "destination", locationKey: "header", menuId: "neighbor", boundAt: NOW });
  const record = menu({ locations: ["header"], doc: { type: "menu", version: 1,
    items: [{ id: "broken-link", label: "Link", target: { kind: "url", href: "" } }] } });
  await assert.rejects(importMenuEntity({ deps, input: { workspaceId: "destination", record } }),
    { message: "url target requires a non-empty href" });
  assert.deepEqual(await deps.repo.list({ workspaceId: "destination" }), []);
  assert.deepEqual(await deps.bindingRepo.findByLocation({ workspaceId: "destination", locationKey: "header" }),
    { workspaceId: "destination", locationKey: "header", menuId: "neighbor", boundAt: NOW });
  assert.deepEqual(events, []);
});

// F1.2/F6.3: returning displacedMenus: [] (or only the last displacement) must fail,
// even when the existing integration tests still observe correct binding changes.
test("import returns every displaced menu with its new version and retained locations", async () => {
  const { deps } = harness();
  const header = menu({ id: "former-header", slug: "old-header", title: "Header", version: 7, locations: ["header", "sidebar"] });
  const footer = menu({ id: "former-footer", slug: "old-footer", title: "Footer", version: 11, locations: ["footer", "utility"] });
  await deps.repo.save(header);
  await deps.repo.save(footer);
  for (const [locationKey, menuId] of [["header", "former-header"], ["sidebar", "former-header"], ["footer", "former-footer"], ["utility", "former-footer"]] as const) {
    await deps.bindingRepo.upsert({ workspaceId: "destination", locationKey, menuId, boundAt: "old-time" });
  }

  const result = await importMenuEntity({ deps, input: {
    workspaceId: "destination", record: menu({ workspaceId: "source", locations: ["header", "footer"] }),
  } });

  assert.deepEqual(result.displacedMenus, [
    menu({ id: "former-header", slug: "old-header", title: "Header", version: 8, updatedAt: NOW, locations: ["sidebar"] }),
    menu({ id: "former-footer", slug: "old-footer", title: "Footer", version: 12, updatedAt: NOW, locations: ["utility"] }),
  ]);
  assert.deepEqual(await deps.repo.findById({ workspaceId: "destination", id: "former-header" }),
    menu({ id: "former-header", slug: "old-header", title: "Header", version: 8, updatedAt: NOW, locations: ["sidebar"] }));
  assert.deepEqual(await deps.repo.findById({ workspaceId: "destination", id: "former-footer" }),
    menu({ id: "former-footer", slug: "old-footer", title: "Footer", version: 12, updatedAt: NOW, locations: ["utility"] }));
  for (const locationKey of ["header", "footer"]) {
    assert.deepEqual(await deps.bindingRepo.findByLocation({ workspaceId: "destination", locationKey }),
      { workspaceId: "destination", locationKey, menuId: "incoming", boundAt: NOW });
  }
  for (const [locationKey, menuId] of [["sidebar", "former-header"], ["utility", "former-footer"]] as const) {
    assert.deepEqual(await deps.bindingRepo.findByLocation({ workspaceId: "destination", locationKey }),
      { workspaceId: "destination", locationKey, menuId, boundAt: "old-time" });
  }
});

/** `repo` where another writer bumps `raceId` (title "Other writer") right after the import reads it. */
function racing(repo: InMemoryMenuRepo, raceId: string): MenuRepoPort {
  return {
    findById: async (required) => {
      const row = await repo.findById(required);
      if (row && row.id === raceId) await repo.save({ ...row, title: "Other writer", version: row.version + 1 });
      return row;
    },
    findBySlug: (required) => repo.findBySlug(required),
    list: (required) => repo.list(required),
    save: (record, options) => repo.save(record, options),
    remove: (required) => repo.remove(required),
    transaction: (required) => repo.transaction(required),
  };
}

test("an import-as-update loses to a writer that lands between its read and its save: no overwrite, binding or event", async () => {
  const { deps, events } = harness();
  await deps.repo.save(menu());
  await assert.rejects(
    importMenuEntity({ deps: { ...deps, repo: racing(deps.repo, "incoming") }, input: { workspaceId: "destination", record: menu({ workspaceId: "source", title: "Published", locations: ["header"] }), expectedVersion: 4 } }),
    (error: unknown) => error instanceof MenuVersionConflictError && error.message === "menu 'incoming' was modified concurrently (expected version 4, found 5)"
  );
  const stored = await deps.repo.findById({ workspaceId: "destination", id: "incoming" });
  assert.deepEqual([stored?.title, stored?.version], ["Other writer", 5]);
  assert.equal(await deps.bindingRepo.findByLocation({ workspaceId: "destination", locationKey: "header" }), null);
  assert.deepEqual(events, []);
});

test("two concurrent import-as-creates of one id: exactly one lands, with one created event", async () => {
  const { deps, events } = harness();
  const create = (title: string) => importMenuEntity({ deps, input: { workspaceId: "destination", record: menu({ workspaceId: "source", title }) } });
  const results = await Promise.allSettled([create("First"), create("Second")]);

  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "rejected"]);
  const lost = results[1] as PromiseRejectedResult;
  assert.ok(lost.reason instanceof MenuVersionConflictError);
  assert.equal(lost.reason.message, "menu 'incoming' already exists (expected no menu, found version 1)");
  const stored = await deps.repo.findById({ workspaceId: "destination", id: "incoming" });
  assert.deepEqual([stored?.title, stored?.version], ["First", 1]);
  assert.deepEqual(events.map((event) => event.name), ["navigation.menu.created"]);
});

test("a displaced menu's save loses to a writer that lands between its read and its save instead of overwriting it", async () => {
  const { deps } = harness();
  await deps.repo.save(menu({ id: "former-header", slug: "old-header", title: "Header", version: 7, locations: ["header"] }));
  await deps.bindingRepo.upsert({ workspaceId: "destination", locationKey: "header", menuId: "former-header", boundAt: "old-time" });
  await assert.rejects(
    importMenuEntity({ deps: { ...deps, repo: racing(deps.repo, "former-header") }, input: { workspaceId: "destination", record: menu({ workspaceId: "source", locations: ["header"] }) } }),
    (error: unknown) => error instanceof MenuVersionConflictError && error.message === "menu 'former-header' was modified concurrently (expected version 7, found 8)"
  );
  const displaced = await deps.repo.findById({ workspaceId: "destination", id: "former-header" });
  assert.deepEqual([displaced?.title, displaced?.locations, displaced?.version], ["Other writer", ["header"], 8]);
  assert.equal((await deps.bindingRepo.findByLocation({ workspaceId: "destination", locationKey: "header" }))?.menuId, "former-header");
});
