import { describeTrashError, formRowMenuItems } from "./harness.js";
import { assert, describe, expect, it, vi } from "vitest";

import { ApiError } from "./harness.js";
import type { AdminFormDefinition } from "../models.js";
import { formDateDisplay, formDatesLines, formsListError, newestUpdatedForms } from "../rules.js";
import { t } from "./harness.js";

describe("submission date display", () => {
  it("uses local date and time while preserving the precise submission instant", () => {
    expect(formDateDisplay({ iso: "2026-10-06T03:12:05.365Z", locale: "en-US" }, { timeZone: "America/Los_Angeles" })).toEqual({
      text: "10/5/26, 8:12 PM", full: "Oct 5, 2026, 8:12 PM", dateTime: "2026-10-06T03:12:05.365Z",
    });
    expect(formDateDisplay({ iso: "2026-10-06T03:12:05.365Z", locale: "en-GB" }, { timeZone: "UTC" }).text)
      .toBe("06/10/2026, 03:12");
  });

  it.each(["", "invalid"])("shows a dash for a malformed stored timestamp (%s)", (iso) => {
    expect(formDateDisplay({ iso, locale: "en-US" })).toEqual({ text: "—", full: "—", dateTime: undefined });
  });
});

/**
 * @file T7a (2026-09-21) pure-logic coverage: the forms-delete confirm flow's `RowMenu` items, its
 * error-banner precedence, and the shared `describeTrashError` classifier `useFormsList` (forms) and
 * `useFormSubmissionDetail` (submissions) both use for their `api.trash` failures. No dedicated
 * `rules.unit.test.ts` existed for `features/forms` before this pass — `formRowMenuItems`/
 * `formsListError` were previously only exercised indirectly through `FormsList.unit.test.tsx`'s
 * full-component render.
 */

function form(overrides: Partial<AdminFormDefinition> = {}): AdminFormDefinition {
  return {
    id: "f1",
    workspaceId: "fake-ws",
    name: "Contact",
    slug: "contact",
    fields: [],
    notify: { enabled: false, recipients: [] },
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("forms list dates", () => {
  const datedForm = form({ createdAt: "2026-10-04T09:52:00Z", updatedAt: "2026-10-05T14:03:00Z" });
  const english = { locale: "en-US", t: (key: string) => key };

  it("shows created on line 1 and updated on line 2 as short locale date + time, full labels for hover", () => {
    expect(formDatesLines({ form: datedForm, ...english }, { timeZone: "UTC" })).toEqual([
      { kind: "created", text: "10/4/26, 9:52 AM", dateTime: "2026-10-04T09:52:00.000Z", label: "Created Oct 4, 2026, 9:52 AM" },
      { kind: "updated", text: "10/5/26, 2:03 PM", dateTime: "2026-10-05T14:03:00.000Z", label: "Updated Oct 5, 2026, 2:03 PM" },
    ]);
    expect(formDatesLines({ form: datedForm, ...english }, { timeZone: "America/Los_Angeles" }).map((line) => line.text))
      .toEqual(["10/4/26, 2:52 AM", "10/5/26, 7:03 AM"]);
  });

  it("collapses to one line when updated shows the same date and minute as created", () => {
    // 41 seconds apart: different instants, identical displayed minute.
    const sameMinute = { createdAt: "2026-10-03T09:56:05Z", updatedAt: "2026-10-03T09:56:46Z" };
    expect(formDatesLines({ form: sameMinute, ...english }, { timeZone: "UTC" })).toEqual([
      {
        kind: "both",
        text: "10/3/26, 9:56 AM",
        dateTime: "2026-10-03T09:56:05.000Z",
        label: "Created Oct 3, 2026, 9:56 AM · Updated Oct 3, 2026, 9:56 AM",
      },
    ]);
    // One minute later is a real edit: two lines again.
    expect(formDatesLines({ form: { ...sameMinute, updatedAt: "2026-10-03T09:57:00Z" }, ...english }, { timeZone: "UTC" }))
      .toHaveLength(2);
  });

  it("lets the admin locale pick the date order and translate the hover labels", () => {
    expect(formDatesLines({ form: datedForm, locale: "de", t: (key) => t({ locale: "de", key: key }) }, { timeZone: "UTC" })).toEqual([
      { kind: "created", text: "04.10.26, 09:52", dateTime: "2026-10-04T09:52:00.000Z", label: "Erstellt 4. Okt. 2026, 9:52" },
      { kind: "updated", text: "05.10.26, 14:03", dateTime: "2026-10-05T14:03:00.000Z", label: "Aktualisiert 5. Okt. 2026, 14:03" },
    ]);
    const [created] = formDatesLines({ form: datedForm, locale: "en-GB", t: (key) => key }, { timeZone: "UTC" });
    assert.isDefined(created);
    expect(created.text)
      .toBe("04/10/2026, 09:52");
  });

  it("tolerates missing or malformed dates without hiding the valid event", () => {
    expect(formDatesLines({ form: { createdAt: "", updatedAt: datedForm.updatedAt }, ...english }, { timeZone: "UTC" })).toEqual([
      { kind: "created", text: "—", dateTime: undefined, label: "Created —" },
      { kind: "updated", text: "10/5/26, 2:03 PM", dateTime: "2026-10-05T14:03:00.000Z", label: "Updated Oct 5, 2026, 2:03 PM" },
    ]);
    expect(formDatesLines({ form: { createdAt: "invalid", updatedAt: "invalid" }, ...english })).toEqual([
      { kind: "both", text: "—", dateTime: undefined, label: "Created — · Updated —" },
    ]);
  });

  it("sorts by update instant, preserves ties and never mutates the input", () => {
    const older = form({ id: "old", createdAt: "2026-10-04T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z" });
    const newer = form({ id: "new", updatedAt: "2026-10-04T09:52:00Z" });
    const sameInstant = form({ id: "tie", updatedAt: "2026-10-04T02:52:00-07:00" });
    const invalid = form({ id: "invalid", updatedAt: "bad" });
    const forms = Object.freeze([older, newer, invalid, sameInstant]);
    expect(newestUpdatedForms({ forms }).map((entry) => entry.id)).toEqual(["new", "tie", "old", "invalid"]);
    expect(forms.map((entry) => entry.id)).toEqual(["old", "new", "invalid", "tie"]);
    expect(newestUpdatedForms({ forms: [] })).toEqual([]);
  });
});

describe("describeTrashError", () => {
  const versionChangedMessage = "This item changed since you loaded it. Reload and try again.";
  it("returns no message and alreadyGone: false for a null error", () => {
    expect(describeTrashError(null, "failed to delete form", versionChangedMessage)).toEqual({ alreadyGone: false, message: null });
  });

  it("classifies a 404 as already-gone with no banner message — a quiet refetch, not an error", () => {
    const result = describeTrashError(new ApiError("not found", 404, "NOT_FOUND"), "failed to delete form", versionChangedMessage);
    expect(result).toEqual({ alreadyGone: true, message: null });
  });

  it("classifies a 409 TRASH_VERSION_CHANGED with the specific reload-and-retry copy", () => {
    const result = describeTrashError(new ApiError("changed", 409, "TRASH_VERSION_CHANGED"), "failed to delete form", versionChangedMessage);
    expect(result).toEqual({
      alreadyGone: false,
      message: "This item changed since you loaded it. Reload and try again.",
    });
  });

  it("falls through to the generic fallback for any other ApiError", () => {
    const result = describeTrashError(new ApiError("nope", 403, "FORBIDDEN"), "failed to delete form", versionChangedMessage);
    expect(result.alreadyGone).toBe(false);
    expect(result.message).toBe("nope");
  });

  it("falls through to the fallback for a non-ApiError failure (e.g. a network error)", () => {
    const result = describeTrashError(new Error("network down"), "failed to delete form", versionChangedMessage);
    expect(result).toEqual({ alreadyGone: false, message: "network down" });
  });
});

describe("formsListError", () => {
  const copy = {
    deleteFallback: "failed to delete form",
    statusUpdateFallback: "failed to update form status",
    loadFormsFallback: "failed to load forms",
    versionChangedMessage: "This item changed since you loaded it. Reload and try again.",
  };
  it("is null when nothing failed and forms are loaded", () => {
    expect(formsListError({ toggleError: null, deleteError: null, listError: null, hasForms: true, ...copy })).toBeNull();
  });

  it("a delete's own version-changed failure outranks the toggle and list errors", () => {
    const message = formsListError({
      toggleError: new Error("toggle failed"),
      deleteError: new ApiError("changed", 409, "TRASH_VERSION_CHANGED"),
      listError: new Error("list failed"),
      hasForms: true,
      ...copy,
    });
    expect(message).toBe("This item changed since you loaded it. Reload and try again.");
  });

  it("a delete's 404 (already gone) contributes no banner, so the toggle error surfaces instead", () => {
    const message = formsListError({
      toggleError: new Error("toggle failed"),
      deleteError: new ApiError("gone", 404, "NOT_FOUND"),
      listError: null,
      hasForms: true,
      ...copy,
    });
    expect(message).toBe("toggle failed");
  });

  it("falls back to the list error only once forms have never loaded", () => {
    const message = formsListError({ toggleError: null, deleteError: null, listError: new Error("boom"), hasForms: false, ...copy });
    expect(message).toBe("boom");
  });

  it("a background list-refresh failure is suppressed once forms have already loaded", () => {
    const message = formsListError({ toggleError: null, deleteError: null, listError: new Error("boom"), hasForms: true, ...copy });
    expect(message).toBeNull();
  });
});

describe("formRowMenuItems", () => {
  const handlers = { onEdit: () => {}, onToggleStatus: () => {}, onDelete: () => {} };

  it("includes a destructive-toned Delete item that opens the confirm (onDelete), not the port", () => {
    const items = formRowMenuItems(form(), handlers, (k) => k);
    const deleteItem = items.find((i) => i.key === "delete");
    expect(deleteItem).toBeDefined();
    expect(deleteItem?.tone).toBe("danger");
    expect(deleteItem?.label).toBe("Delete");
  });

  it("Delete's onSelect calls handlers.onDelete with the form, not handlers.onToggleStatus", () => {
    const calls: AdminFormDefinition[] = [];
    const onToggleStatus = vi.fn();
    const items = formRowMenuItems(form({ id: "f9" }), { ...handlers, onToggleStatus, onDelete: (f) => calls.push(f) }, (k) => k);
    items.find((i) => i.key === "delete")?.onSelect();
    expect(calls).toEqual([form({ id: "f9" })]);
    expect(onToggleStatus).not.toHaveBeenCalled();
  });

  it("keeps Edit and the status toggle present alongside Delete (three items total)", () => {
    const items = formRowMenuItems(form({ status: "active" }), handlers, (k) => k);
    expect(items.map((i) => i.key)).toEqual(["edit", "toggle-status", "delete"]);
  });
});
