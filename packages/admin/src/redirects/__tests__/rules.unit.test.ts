import { assert, describe, expect, it, vi } from "vitest";

import {
  KEYS,
  buildCreateRedirectPayload,
  firstWriteError,
  isAnyWritePending,
  nextRedirectStatus,
  parseImportPayload,
  redirectRowMenuItems,
  visibleRedirectsError,
  type WriteState,
} from "./rules-harness.js";
import type { LegacyRedirect as AdminRedirect } from "./rules-harness.js";

/**
 * @file Pure-logic coverage for `features/redirects/rules.ts`. `rules.ts` has no React and no I/O,
 * so every branch here is cheap to exercise directly — no rendering, no fetch mocking.
 */

const BASE_RULE: AdminRedirect = {
  id: "r1",
  workspaceId: "ws1",
  matchType: "exact",
  fromPattern: "/old",
  toTarget: "/new",
  statusCode: 301,
  status: "active",
  override: false,
  priority: 0,
  source: "manual",
  sourceEntryId: null,
  fromPathAtCapture: null,
  toPathAtCapture: null,
  createdByPrincipal: "p1",
  createdByPluginId: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  version: 1,
};

describe("nextRedirectStatus", () => {
  it("returns disabled for an active rule", () => {
    expect(nextRedirectStatus("active")).toBe("disabled");
  });

  it("returns active for anything not literally 'active' (disabled, or any other status string)", () => {
    expect(nextRedirectStatus("disabled")).toBe("active");
    expect(nextRedirectStatus("tombstoned")).toBe("active");
    expect(nextRedirectStatus("")).toBe("active");
  });
});

describe("buildCreateRedirectPayload", () => {
  it("reads all four fields off FormData, coercing statusCode to a number", () => {
    const form = new FormData();
    form.set("matchType", "prefix");
    form.set("fromPattern", "/old-path");
    form.set("toTarget", "/new-path");
    form.set("statusCode", "302");

    expect(buildCreateRedirectPayload(form)).toEqual({
      matchType: "prefix",
      fromPattern: "/old-path",
      toTarget: "/new-path",
      statusCode: 302,
    });
  });

  it("defaults matchType to 'exact' and statusCode to 301 when absent", () => {
    const form = new FormData();
    form.set("fromPattern", "/a");
    form.set("toTarget", "/b");

    expect(buildCreateRedirectPayload(form)).toEqual({
      matchType: "exact",
      fromPattern: "/a",
      toTarget: "/b",
      statusCode: 301,
    });
  });

  it("defaults missing fromPattern/toTarget to empty strings rather than throwing", () => {
    const form = new FormData();
    expect(buildCreateRedirectPayload(form)).toEqual({
      matchType: "exact",
      fromPattern: "",
      toTarget: "",
      statusCode: 301,
    });
  });
});

describe("redirectRowMenuItems", () => {
  it("labels the toggle item 'Disable' for an active rule and wires onToggleStatus", () => {
    const onToggleStatus = () => {};
    const onRequestDelete = () => {};
    const items = redirectRowMenuItems(BASE_RULE, { onToggleStatus, onRequestDelete }, "en");

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ key: "toggle", label: "Disable" });
    expect(items[1]).toMatchObject({ key: "delete", label: "Delete", destructive: true });
  });

  it("labels the toggle item 'Enable' for a non-active rule", () => {
    const items = redirectRowMenuItems(
      { ...BASE_RULE, status: "disabled" },
      { onToggleStatus: () => {}, onRequestDelete: () => {} },
      "en",
    );
    expect(items[0]).toMatchObject({ label: "Enable" });
  });

  it("wires each item's onSelect to the matching handler with the rule itself", () => {
    const onToggleStatus = vi.fn();
    const onRequestDelete = vi.fn();
    const items = redirectRowMenuItems(BASE_RULE, { onToggleStatus, onRequestDelete }, "en");

    assert.isDefined(items[0]);
    items[0].onSelect?.();
    expect(onToggleStatus).toHaveBeenCalledTimes(1);
    expect(onToggleStatus).toHaveBeenCalledWith(BASE_RULE);
    expect(onRequestDelete).not.toHaveBeenCalled();
    onToggleStatus.mockClear();

    assert.isDefined(items[1]);
    items[1].onSelect?.();
    expect(onRequestDelete).toHaveBeenCalledTimes(1);
    expect(onRequestDelete).toHaveBeenCalledWith(BASE_RULE);
    expect(onToggleStatus).not.toHaveBeenCalled();
  });

  it("translates labels to Spanish when locale is es", () => {
    const items = redirectRowMenuItems(BASE_RULE, { onToggleStatus: () => {}, onRequestDelete: () => {} }, "es");
    expect(items.map((i) => i.label)).toEqual(["Desactivar", "Eliminar"]);
    const disabled = redirectRowMenuItems(
      { ...BASE_RULE, status: "disabled" },
      { onToggleStatus: () => {}, onRequestDelete: () => {} },
      "es",
    );
    assert.isDefined(disabled[0]);
    expect(disabled[0].label).toBe("Activar");
  });
});

describe("isAnyWritePending", () => {
  it("is false when every write is idle", () => {
    const writes: WriteState[] = [
      { status: "idle", error: null },
      { status: "success", error: null },
      { status: "error", error: new Error("x") },
    ];
    expect(isAnyWritePending(writes)).toBe(false);
  });

  it("is true when any single write is pending", () => {
    const writes: WriteState[] = [
      { status: "idle", error: null },
      { status: "pending", error: null },
      { status: "idle", error: null },
    ];
    expect(isAnyWritePending(writes)).toBe(true);
  });

  it("is false for an empty write list", () => {
    expect(isAnyWritePending([])).toBe(false);
  });
});

describe("firstWriteError", () => {
  it("returns null when no write has an error", () => {
    const writes: WriteState[] = [
      { status: "idle", error: null },
      { status: "success", error: null },
    ];
    expect(firstWriteError(writes)).toBeNull();
  });

  it("returns the first errored write in ARRAY order, not most-recent — a later successful write must not mask an earlier failure by recency", () => {
    const createError = new Error("create failed");
    const deleteError = new Error("delete failed");
    // `create` failed first (array position 0); `delete` failed after it (position 2). Recency
    // would pick `deleteError`; the documented contract picks `createError`.
    const writes: WriteState[] = [
      { status: "error", error: createError },
      { status: "success", error: null },
      { status: "error", error: deleteError },
    ];
    expect(firstWriteError(writes)).toBe(createError);
  });
});

describe("visibleRedirectsError", () => {
  it("prefers an active write's own failure over everything else", () => {
    const writeError = new Error("write failed");
    const listError = new Error("list failed");
    expect(visibleRedirectsError({ writeError, saving: true, listError })).toBe(writeError);
    expect(visibleRedirectsError({ writeError, saving: false, listError })).toBe(writeError);
  });

  it("suppresses a background list-refresh failure while a write is in flight, even with no writeError yet", () => {
    const listError = new Error("stale list failure");
    expect(visibleRedirectsError({ writeError: null, saving: true, listError })).toBeNull();
  });

  it("surfaces the list failure once nothing is writing and there is no write error", () => {
    const listError = new Error("list failed");
    expect(visibleRedirectsError({ writeError: null, saving: false, listError })).toBe(listError);
  });

  it("returns null when nothing has failed", () => {
    expect(visibleRedirectsError({ writeError: null, saving: false, listError: null })).toBeNull();
  });
});

describe("parseImportPayload", () => {
  it("rejects invalid JSON with 'Not valid JSON.'", () => {
    expect(parseImportPayload("{not json", (key) => key)).toEqual({ ok: false, error: "Not valid JSON." });
  });

  it("rejects valid JSON that is not an array", () => {
    expect(parseImportPayload('{"a":1}', (key) => key)).toEqual({ ok: false, error: "Must be a JSON array of rule objects." });
    expect(parseImportPayload('"just a string"', (key) => key)).toEqual({ ok: false, error: "Must be a JSON array of rule objects." });
    expect(parseImportPayload("42", (key) => key)).toEqual({ ok: false, error: "Must be a JSON array of rule objects." });
  });

  it("accepts an empty array", () => {
    expect(parseImportPayload("[]", (key) => key)).toEqual({ ok: true, rules: [] });
  });

  it("accepts a well-shaped array without validating item contents (server is the real validator)", () => {
    const raw = JSON.stringify([{ matchType: "exact", fromPattern: "/a", toTarget: "/b", statusCode: 301 }]);
    expect(parseImportPayload(raw, (key) => key)).toEqual({
      ok: true,
      rules: [{ matchType: "exact", fromPattern: "/a", toTarget: "/b", statusCode: 301 }],
    });
  });
});

describe("KEYS", () => {
  it("gives the list and a hit-count cache key that nests under it by prefix, so invalidating the list also invalidates every row's hit count", () => {
    expect(KEYS.list).toEqual(["redirects"]);
    const hits = KEYS.hits("r1");
    expect(hits).toEqual(["redirects", "r1", "hits"]);
    expect(hits.slice(0, KEYS.list.length)).toEqual(KEYS.list);
  });

  it("scopes the hit-count key per redirect id — two different ids never collide", () => {
    expect(KEYS.hits("r1")).not.toEqual(KEYS.hits("r2"));
  });
});
