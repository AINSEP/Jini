/**
 * Boundary and refusal paths of `menu-service.ts` that the behaviour-level suites do not reach:
 * each untrusted-input rejection with its exact message, the version-conflict wording for a create,
 * the slug-change uniqueness check, and the already-assigned location no-op.
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import type { DomainEvent, OutboxPort } from "../../core/ports.js";
import {
  assignLocation,
  createMenu,
  isAllowedHref,
  MenuConflictError,
  MenuNotFoundError,
  MenuValidationError,
  MenuVersionConflictError,
  menuVersionConflictError,
  updateMenuTree,
  validateAndCloneTree,
} from "../menu-service.js";
import { InMemoryMenuRepo, InMemoryNavLocationBindingRepo } from "../repo.memory.js";
import { NAV_DOC_TYPE, type NavItemNode, type NavMenuEntry } from "../types.js";

const clock = { nowMs: () => Date.parse("2026-07-10T00:00:00.000Z") };

function fakeIdGen() {
  let counter = 0;
  return { newId: () => `id-${++counter}` };
}

function fakeOutbox(): { outbox: OutboxPort; enqueued: DomainEvent[] } {
  const enqueued: DomainEvent[] = [];
  const outbox: OutboxPort = {
    enqueue: async (event) => {
      enqueued.push(event);
    },
    claimPending: async () => [],
    markDelivered: async () => {},
    markFailed: async () => {},
  };
  return { outbox, enqueued };
}

function storedMenu(overrides: Partial<NavMenuEntry> & { id: string; slug: string }): NavMenuEntry {
  return {
    workspaceId: "ws-1",
    title: "Menu",
    status: "published",
    doc: { type: NAV_DOC_TYPE, version: 1, items: [] },
    locations: [],
    updatedAt: "2026-07-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

/** A store whose slug lookup ignores case, the way a SQL adapter with a NOCASE collation would. */
class CaseInsensitiveSlugRepo extends InMemoryMenuRepo {
  override async findBySlug(required: { workspaceId: string; slug: string }): Promise<NavMenuEntry | null> {
    const rows = await this.list({ workspaceId: required.workspaceId });
    return rows.find((row) => row.slug.toLowerCase() === required.slug.toLowerCase()) ?? null;
  }
}

/** Untrusted request bodies arrive as parsed JSON, so malformed shapes are built the same way. */
function parsedItems(json: string): readonly NavItemNode[] {
  return JSON.parse(json);
}

function validationError(message: string) {
  return (error: unknown) => error instanceof MenuValidationError && error.message === message;
}

// --- menuVersionConflictError ------------------------------------------------

test("menuVersionConflictError words a create that found the id taken", () => {
  const error = menuVersionConflictError({ id: "m-1", expectedVersion: null, found: 3 });
  assert.ok(error instanceof MenuVersionConflictError);
  assert.equal(error.message, "menu 'm-1' already exists (expected no menu, found version 3)");
});

test("menuVersionConflictError reports 'none' for a create conflict whose adapter could not read the stored version", () => {
  const error = menuVersionConflictError({ id: "m-1", expectedVersion: null, found: null });
  assert.equal(error.message, "menu 'm-1' already exists (expected no menu, found version none)");
});

test("menuVersionConflictError reports 'none' when no stored version was found", () => {
  const error = menuVersionConflictError({ id: "m-1", expectedVersion: 2, found: null });
  assert.equal(error.message, "menu 'm-1' was modified concurrently (expected version 2, found none)");
});

// --- isAllowedHref -----------------------------------------------------------

test("isAllowedHref rejects a '/…' href the URL parser cannot resolve", () => {
  assert.equal(isAllowedHref({ rawHref: "//[" }), false);
});

test("isAllowedHref rejects a protocol-relative href that resolves off-origin", () => {
  assert.equal(isAllowedHref({ rawHref: "//evil.example/x" }), false);
});

// --- validateAndCloneTree ----------------------------------------------------

test("validateAndCloneTree rejects a non-array items value", () => {
  assert.throws(() => validateAndCloneTree({ items: parsedItems('{"id":"a"}') }), validationError("menu items must be an array"));
});

test("validateAndCloneTree rejects a non-array children value", () => {
  const items = parsedItems('[{"id":"a","label":"A","target":{"kind":"route","route":"home"},"children":{"id":"b"}}]');
  assert.throws(() => validateAndCloneTree({ items }), validationError("menu items must be an array"));
});

test("validateAndCloneTree rejects a tree past maxItemCount", () => {
  const items: NavItemNode[] = [
    { id: "a", label: "A", target: { kind: "url", href: "/" } },
    { id: "b", label: "B", target: { kind: "url", href: "/" } },
  ];
  assert.throws(() => validateAndCloneTree({ items }, { maxItemCount: 1 }), validationError("menu tree exceeds max item count of 1"));
});

test("validateAndCloneTree rejects a whitespace-only id", () => {
  const items: NavItemNode[] = [{ id: "  ", label: "A", target: { kind: "url", href: "/" } }];
  assert.throws(() => validateAndCloneTree({ items }), validationError("every menu item requires a non-empty id"));
});

test("validateAndCloneTree throws a TypeError, not a MenuValidationError, for a non-string id (reported, not fixed)", () => {
  // Untrusted JSON can carry a numeric id; `.trim()` on it throws an uncaught TypeError, which the
  // host surfaces as a 500 rather than the intended 400.
  const items = parsedItems('[{"id":5,"label":"A","target":{"kind":"url","href":"/"}}]');
  assert.throws(() => validateAndCloneTree({ items }), (error: unknown) => error instanceof TypeError && !(error instanceof MenuValidationError));
});

test("validateAndCloneTree rejects an unknown target kind", () => {
  const items = parsedItems('[{"id":"a","label":"A","target":{"kind":"banana"}}]');
  assert.throws(() => validateAndCloneTree({ items }), validationError("unknown target kind 'banana'"));
});

test("validateAndCloneTree rejects a url target whose href is not a string", () => {
  const items = parsedItems('[{"id":"a","label":"A","target":{"kind":"url","href":7}}]');
  assert.throws(() => validateAndCloneTree({ items }), validationError("url target requires a non-empty href"));
});

test("validateAndCloneTree reports a whitespace-only url href as missing, not as a disallowed shape", () => {
  const items: NavItemNode[] = [{ id: "a", label: "A", target: { kind: "url", href: "   " } }];
  assert.throws(() => validateAndCloneTree({ items }), validationError("url target requires a non-empty href"));
});

test("validateAndCloneTree accepts an entryRef target with an allowed lastKnownHref", () => {
  const items: NavItemNode[] = [{ id: "a", label: "A", target: { kind: "entryRef", entryId: "e-1", lastKnownHref: "/about" } }];
  assert.deepEqual(validateAndCloneTree({ items }), [{ ...items[0], children: undefined }]);
});

// --- createMenu --------------------------------------------------------------

test("createMenu rejects a blank title", async () => {
  const repo = new InMemoryMenuRepo({});
  await assert.rejects(
    createMenu({ deps: { repo, clock, idGen: fakeIdGen(), outbox: fakeOutbox().outbox }, input: { workspaceId: "ws-1", title: "   ", slug: "main" } }),
    validationError("title is required")
  );
});

test("createMenu rejects a slug with characters outside lowercase letters, numbers and dashes", async () => {
  const repo = new InMemoryMenuRepo({});
  await assert.rejects(
    createMenu({ deps: { repo, clock, idGen: fakeIdGen(), outbox: fakeOutbox().outbox }, input: { workspaceId: "ws-1", title: "Main", slug: "main_nav" } }),
    validationError("slug must use lowercase letters, numbers, and dashes")
  );
});

// --- updateMenuTree ----------------------------------------------------------

test("updateMenuTree rejects an unknown menu id", async () => {
  const repo = new InMemoryMenuRepo({});
  await assert.rejects(
    updateMenuTree({ deps: { repo, clock, idGen: fakeIdGen(), outbox: fakeOutbox().outbox }, input: { workspaceId: "ws-1", id: "missing", expectedVersion: 1 } }),
    (error: unknown) => error instanceof MenuNotFoundError && error.message === "menu 'missing' was not found"
  );
});

test("updateMenuTree rejects a slug change onto a slug another menu holds", async () => {
  const repo = new InMemoryMenuRepo({}, { initialRows: [storedMenu({ id: "m-1", slug: "main" }), storedMenu({ id: "m-2", slug: "footer" })] });
  await assert.rejects(
    updateMenuTree({ deps: { repo, clock, idGen: fakeIdGen(), outbox: fakeOutbox().outbox }, input: { workspaceId: "ws-1", id: "m-1", expectedVersion: 1, slug: "footer" } }),
    (error: unknown) => error instanceof MenuConflictError && !(error instanceof MenuVersionConflictError) && error.message === "slug 'footer' already exists"
  );
});

test("updateMenuTree accepts a slug change onto a free slug", async () => {
  const repo = new InMemoryMenuRepo({}, { initialRows: [storedMenu({ id: "m-1", slug: "main" })] });
  const { menu } = await updateMenuTree({ deps: { repo, clock, idGen: fakeIdGen(), outbox: fakeOutbox().outbox }, input: { workspaceId: "ws-1", id: "m-1", expectedVersion: 1, slug: "Primary" } });
  assert.equal(menu.slug, "primary");
});

test("updateMenuTree does not treat the menu's own row as a slug conflict when the store matches slugs case-insensitively", async () => {
  // A legacy row stored with an uppercase slug normalizes to a different string, and a NOCASE store
  // then returns the same menu for the lookup.
  const repo = new CaseInsensitiveSlugRepo({}, { initialRows: [storedMenu({ id: "m-1", slug: "Main" })] });
  const { menu } = await updateMenuTree({ deps: { repo, clock, idGen: fakeIdGen(), outbox: fakeOutbox().outbox }, input: { workspaceId: "ws-1", id: "m-1", expectedVersion: 1 } });
  assert.equal(menu.slug, "main");
});

// --- assignLocation ----------------------------------------------------------

test("assignLocation rejects an unknown menu id", async () => {
  const repo = new InMemoryMenuRepo({});
  const bindingRepo = new InMemoryNavLocationBindingRepo({});
  await assert.rejects(
    assignLocation({ deps: { repo, bindingRepo, clock, idGen: fakeIdGen(), outbox: fakeOutbox().outbox }, input: { workspaceId: "ws-1", menuId: "missing", locationKey: "header" } }),
    (error: unknown) => error instanceof MenuNotFoundError && error.message === "menu 'missing' was not found"
  );
});

test("assignLocation keeps a location key the menu already holds without duplicating it", async () => {
  const repo = new InMemoryMenuRepo({}, { initialRows: [storedMenu({ id: "m-1", slug: "main", locations: ["header"] })] });
  const bindingRepo = new InMemoryNavLocationBindingRepo({});
  const { menu } = await assignLocation({ deps: { repo, bindingRepo, clock, idGen: fakeIdGen(), outbox: fakeOutbox().outbox }, input: { workspaceId: "ws-1", menuId: "m-1", locationKey: "header" } });
  assert.deepEqual(menu.locations, ["header"]);
  assert.equal(menu.version, 2);
});
