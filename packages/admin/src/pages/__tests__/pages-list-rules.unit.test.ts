import { describe, expect, it, vi } from "vitest";

import { buildPageRowMenuHandleMap, pageRowMenuItems } from "../pages-list-rules.js";
import type { PageListRow } from "../hooks/pages-port.hooks.js";

/**
 * @file Pure logic for `features/pages/rules.ts`.
 *
 * `pageRowMenuItems` mirrors `features/posts/rules.ts`'s `postRowMenuItems` exactly (this feature's
 * own doc comment says so) — the branch worth pinning is the same one: the middle item's key and
 * label flip with the row's own status (Unpublish for published, Publish for draft), replacing the
 * pre-2026-09-22 "Disable" item that was omitted entirely for a draft page rather than rendered
 * disabled.
 * Now: the module is `pages-list-rules.ts`, moved from the host's pages `rules.unit.test.ts`;
 * fixtures are the structural `PageListRow` the list reads.
 */

const PUBLISHED_PAGE: PageListRow = {
  id: "pg1",
  title: "About",
  slug: "about",
  bodyJson: {},
  status: "published",
  updatedAt: "2026-08-01T00:00:00.000Z",
  version: 1,
};

const DRAFT_PAGE: PageListRow = { ...PUBLISHED_PAGE, id: "pg2", title: "Draft Page", status: "draft" };

describe("pageRowMenuItems", () => {
  it("returns Edit, Unpublish, then Delete (in that order) for a published page", () => {
    const items = pageRowMenuItems({ page: PUBLISHED_PAGE, handlers: { onEdit: vi.fn(), onTogglePublish: vi.fn(), onDelete: vi.fn() }, locale: "en" });
    expect(items.map((i) => i.key)).toEqual(["edit", "unpublish", "delete"]);
  });

  it("returns Edit, Publish, then Delete for a draft page — the middle item flips rather than being omitted", () => {
    const items = pageRowMenuItems({ page: DRAFT_PAGE, handlers: { onEdit: vi.fn(), onTogglePublish: vi.fn(), onDelete: vi.fn() }, locale: "en" });
    expect(items.map((i) => i.key)).toEqual(["edit", "publish", "delete"]);
    expect(items.find((i) => i.key === "unpublish")).toBeUndefined();
  });

  it("marks Delete destructive, and Edit/Unpublish not", () => {
    const items = pageRowMenuItems({ page: PUBLISHED_PAGE, handlers: { onEdit: vi.fn(), onTogglePublish: vi.fn(), onDelete: vi.fn() }, locale: "en" });
    expect(items.find((i) => i.key === "delete")).toMatchObject({ label: "Delete", destructive: true });
    expect(items.find((i) => i.key === "edit")).not.toHaveProperty("destructive", true);
    expect(items.find((i) => i.key === "unpublish")).not.toHaveProperty("destructive", true);
  });

  it("wires Edit's onSelect to onEdit with the page, and only onEdit", () => {
    const onEdit = vi.fn();
    const onTogglePublish = vi.fn();
    const onDelete = vi.fn();
    const items = pageRowMenuItems({ page: PUBLISHED_PAGE, handlers: { onEdit, onTogglePublish, onDelete }, locale: "en" });
    items.find((i) => i.key === "edit")!.onSelect();
    expect(onEdit).toHaveBeenCalledWith({ page: PUBLISHED_PAGE });
    expect(onTogglePublish).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("wires Unpublish's onSelect to onTogglePublish with the page, and only onTogglePublish", () => {
    const onEdit = vi.fn();
    const onTogglePublish = vi.fn();
    const onDelete = vi.fn();
    const items = pageRowMenuItems({ page: PUBLISHED_PAGE, handlers: { onEdit, onTogglePublish, onDelete }, locale: "en" });
    items.find((i) => i.key === "unpublish")!.onSelect();
    expect(onTogglePublish).toHaveBeenCalledWith(PUBLISHED_PAGE);
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("wires Publish's onSelect to onTogglePublish with the page, for a draft row", () => {
    const onEdit = vi.fn();
    const onTogglePublish = vi.fn();
    const onDelete = vi.fn();
    const items = pageRowMenuItems({ page: DRAFT_PAGE, handlers: { onEdit, onTogglePublish, onDelete }, locale: "en" });
    items.find((i) => i.key === "publish")!.onSelect();
    expect(onTogglePublish).toHaveBeenCalledWith(DRAFT_PAGE);
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("wires Delete's onSelect to onDelete with the page, and only onDelete", () => {
    const onEdit = vi.fn();
    const onTogglePublish = vi.fn();
    const onDelete = vi.fn();
    const items = pageRowMenuItems({ page: PUBLISHED_PAGE, handlers: { onEdit, onTogglePublish, onDelete }, locale: "en" });
    items.find((i) => i.key === "delete")!.onSelect();
    expect(onDelete).toHaveBeenCalledWith(PUBLISHED_PAGE);
    expect(onEdit).not.toHaveBeenCalled();
    expect(onTogglePublish).not.toHaveBeenCalled();
  });

  it("translates labels to Spanish when locale is es", () => {
    const items = pageRowMenuItems({ page: PUBLISHED_PAGE, handlers: { onEdit: vi.fn(), onTogglePublish: vi.fn(), onDelete: vi.fn() }, locale: "es" });
    expect(items.map((i) => i.label)).toEqual(["Editar", "Anular publicación", "Eliminar"]);
  });
});

describe("buildPageRowMenuHandleMap", () => {
  it("returns an empty map while the list has not loaded (null)", () => {
    expect(buildPageRowMenuHandleMap({ pages: null }).size).toBe(0);
  });

  it("keys a distinct pages-row handle by each page id, so a re-sorted table still finds the right one", () => {
    const map = buildPageRowMenuHandleMap({ pages: [PUBLISHED_PAGE, DRAFT_PAGE] });
    expect([...map.keys()]).toEqual(["pg1", "pg2"]);
    const first = map.get("pg1");
    const second = map.get("pg2");
    expect(first).toBe("pages-row-pg1");
    expect(second).toBe("pages-row-pg2");
    // Derived from the id, not the array position: reversing the input keeps each id's handle.
    const reversed = buildPageRowMenuHandleMap({ pages: [DRAFT_PAGE, PUBLISHED_PAGE] });
    expect(reversed.get("pg1")).toBe(first);
    expect(reversed.get("pg2")).toBe(second);
  });
});
