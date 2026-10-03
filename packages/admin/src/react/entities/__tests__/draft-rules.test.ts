import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminEntityDescriptor, AdminEntityRowData } from "../../../core/ports/entities.js";
import {
  draftForRow,
  emptyDraft,
  fromDatetimeLocalValue,
  invalidDraftFields,
  missingRequiredFields,
  toDatetimeLocalValue,
} from "../rules.js";

/**
 * @file The generic entity editor's draft rules, over the field kinds the browser acceptance run
 * cannot reach.
 *
 * The acceptance test is "the dummy Recipes app rendering in a real admin screen with no per-entity
 * screen". It can only exercise the kinds that app declares, so every assertion below about
 * `integer`, `real` and `boolean` was previously covered by nothing — while the run stayed green,
 * because there was no row on screen that could have been wrong. These are the cases that make a
 * green run mean something.
 */

/** All seven kinds, with the two values a truthiness bug eats (`false`, `0`) reachable. */
const descriptor = {
  name: "widget",
  labelSingular: "Widget",
  labelPlural: "Widgets",
  titleField: "title",
  fields: [
    { name: "title", kind: "text", required: true },
    { name: "note", kind: "text" },
    { name: "count", kind: "integer", required: true },
    { name: "ratio", kind: "real" },
    { name: "active", kind: "boolean", required: true },
    { name: "optIn", kind: "boolean" },
    { name: "at", kind: "datetime", required: true },
    { name: "ownerId", kind: "relation", target: "owner", required: true },
    { name: "payload", kind: "json" },
  ],
} as const satisfies AdminEntityDescriptor;

describe("emptyDraft", () => {
  it("gives every declared field a key, so no control starts uncontrolled", () => {
    expect(Object.keys(emptyDraft({ descriptor: descriptor })).sort()).toEqual(
      descriptor.fields.map((field) => field.name).sort(),
    );
  });

  // The trap: an absent value fails the required check, but `false` is a checkbox's RESTING state.
  // Without this floor the operator must tick and untick to satisfy a requirement the unticked box
  // was already expressing.
  it("floors a required boolean at false and leaves an optional one absent", () => {
    const draft = emptyDraft({ descriptor: descriptor });
    expect(draft.active).toBe(false);
    expect(draft.optIn).toBeUndefined();
    expect(missingRequiredFields({ descriptor: descriptor, draft: draft })).not.toContain("active");
  });

  it("does not floor any non-boolean kind", () => {
    const draft = emptyDraft({ descriptor: descriptor });
    expect(draft.count).toBeUndefined();
    expect(draft.title).toBeUndefined();
  });
});

describe("draftForRow", () => {
  const row: AdminEntityRowData = {
    id: "w1",
    title: "Widget one",
    count: 0,
    active: false,
    at: "2026-01-15T00:00:00.000Z",
    ownerId: "owner-1",
  };

  it("keeps `false` and `0` from the row rather than reading them as absent", () => {
    const draft = draftForRow({ descriptor, row: row });
    expect(draft.count).toBe(0);
    expect(draft.active).toBe(false);
    expect(missingRequiredFields({ descriptor: descriptor, draft: draft })).toEqual([]);
  });

  // The same trap as `emptyDraft`'s, arriving by the other door: an app that adds a `required`
  // boolean to its descriptor has existing rows that predate it. A draft built as `{ ...row }`
  // inherits the gap, and the editor blocks Save on an unticked box that already says "no".
  it("floors a required boolean the row does not carry", () => {
    const { active, ...withoutActive } = row;
    void active;
    const draft = draftForRow({ descriptor, row: withoutActive as AdminEntityRowData });
    expect(draft.active).toBe(false);
    expect(missingRequiredFields({ descriptor: descriptor, draft: draft })).toEqual([]);
  });

  // An adapter that patches a row with an absent value leaves an OWN key holding `undefined`, and
  // a spread would copy it straight over the floor above.
  it("does not let an explicit `undefined` on the row overwrite the floor", () => {
    const draft = draftForRow({ descriptor, row: { ...row, active: undefined } });
    expect(draft.active).toBe(false);
  });

  it("copies only declared fields, so `id` and adapter drift never reach the payload", () => {
    const draft = draftForRow({ descriptor, row: { ...row, workspaceId: "ws-1" } });
    expect(draft).not.toHaveProperty("id");
    expect(draft).not.toHaveProperty("workspaceId");
  });

  it("is the empty draft when there is no row", () => {
    expect(draftForRow({ descriptor, row: null })).toEqual(emptyDraft({ descriptor: descriptor }));
  });
});

describe("missingRequiredFields", () => {
  it("reports every required field of a fresh draft except the floored boolean", () => {
    expect([...missingRequiredFields({ descriptor, draft: emptyDraft({ descriptor }) })].sort()).toEqual([
      "at",
      "count",
      "ownerId",
      "title",
    ]);
  });

  it("treats an empty string as unfilled for a text box", () => {
    expect(missingRequiredFields({ descriptor, draft: { ...emptyDraft({ descriptor }), title: "" } })).toContain(
      "title",
    );
  });

  // `""` is a legitimate JSON value that is visibly on screen; calling it unfilled would block Save
  // on something the operator can see and did type.
  it("does not treat the JSON string \"\" as unfilled", () => {
    const jsonRequired = {
      ...descriptor,
      fields: [{ name: "payload", kind: "json", required: true }],
      titleField: "payload",
    } as unknown as AdminEntityDescriptor;
    expect(missingRequiredFields({ descriptor: jsonRequired, draft: { payload: "" } })).toEqual([]);
  });
});

describe("invalidDraftFields", () => {
  const filled = {
    title: "Widget one",
    count: 3,
    active: true,
    at: "2026-01-15T00:00:00.000Z",
    ownerId: "owner-1",
  };

  it("passes a conforming draft", () => {
    expect(invalidDraftFields({ descriptor: descriptor, draft: filled })).toEqual([]);
  });

  // `step="1"` constrains the spinner, not the parsed value: `1.5` typed into an integer field is
  // reachable from the shipped control, and the port's own conformance walk calls it a violation.
  it("rejects a fractional value in an integer field", () => {
    expect(invalidDraftFields({ descriptor: descriptor, draft: { ...filled, count: 1.5 } })).toEqual([
      { field: "count", detail: expect.stringMatching(/is not an integer/) as unknown as string },
    ]);
  });

  // `1e400` is valid input to `<input type="number">` and becomes `Infinity`, which becomes `null`
  // the moment it meets `JSON.stringify` on any real transport.
  it("rejects a non-finite value in a real field", () => {
    const problems = invalidDraftFields({ descriptor: descriptor, draft: { ...filled, ratio: Number.POSITIVE_INFINITY } });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.field).toBe("ratio");
    expect(problems[0]?.detail).toMatch(/is not a finite number/);
  });

  it("rejects an unparseable datetime rather than dropping it", () => {
    const problems = invalidDraftFields({ descriptor: descriptor, draft: { ...filled, at: "2026-13-45T99:99" } });
    expect(problems[0]?.field).toBe("at");
    expect(problems[0]?.detail).toMatch(/not a parseable ISO-8601/);
  });

  it("accepts `false` and `0` instead of skipping them as blank", () => {
    expect(invalidDraftFields({ descriptor: descriptor, draft: { ...filled, active: false, count: 0, ratio: 0 } })).toEqual(
      [],
    );
  });

  it("skips absent values, leaving them to the required check", () => {
    expect(invalidDraftFields({ descriptor: descriptor, draft: {} })).toEqual([]);
  });

  it("reports every bad field at once rather than only the first", () => {
    const problems = invalidDraftFields({ descriptor: descriptor, draft: { ...filled, count: 1.5, ratio: Number.NaN } });
    expect(problems.map((problem) => problem.field)).toEqual(["count", "ratio"]);
  });
});

/**
 * The half of item H that only fails on a machine that is not set to UTC.
 *
 * The whole point of the finding is that a local-zone conversion is invisible to its author and
 * corrupting for everyone else, so asserting it under the runner's own zone would reproduce exactly
 * the blind spot. `TZ` is forced to a zone with a DST offset, and the first assertion checks that
 * the override actually took — a test that silently degrades to "UTC on a UTC box" would be the
 * same fault in test form.
 */
describe("datetime round trip (forced non-UTC runner)", () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("is actually running in a non-UTC zone, or every assertion below is vacuous", () => {
    expect(new Date("2026-07-01T12:00:00.000Z").getHours()).not.toBe(12);
  });

  it("shows a stored instant in UTC, not in the viewer's zone", () => {
    expect(toDatetimeLocalValue({ value: "2026-07-01T12:00:00.000Z" })).toBe("2026-07-01T12:00:00");
  });

  it("writes the control's value back as UTC", () => {
    expect(fromDatetimeLocalValue({ raw: "2026-07-01T12:00:00" })).toBe("2026-07-01T12:00:00.000Z");
  });

  it("round-trips without moving the instant", () => {
    const stored = "2026-11-02T05:30:00.000Z";
    expect(fromDatetimeLocalValue({ raw: toDatetimeLocalValue({ value: stored }) })).toBe(stored);
  });

  // `slice(0, 16)` matches the `datetime-local` default and quietly rewrites `10:30:45Z` as
  // `10:30:00Z` on the next Save of a row nobody meant to change the time of. Every timestamp in
  // the dummy app is midnight, so the truncation is a no-op in the only data the acceptance run
  // ever sees.
  it("carries seconds instead of truncating them to the minute", () => {
    const stored = "2026-01-15T10:30:45.000Z";
    expect(toDatetimeLocalValue({ value: stored })).toBe("2026-01-15T10:30:45");
    expect(fromDatetimeLocalValue({ raw: toDatetimeLocalValue({ value: stored }) })).toBe(stored);
  });

  it("accepts a minute-precision control value", () => {
    expect(fromDatetimeLocalValue({ raw: "2026-01-15T10:30" })).toBe("2026-01-15T10:30:00.000Z");
  });

  it("shows an empty control for anything unparseable, and clears to undefined", () => {
    expect(toDatetimeLocalValue({ value: "yesterday" })).toBe("");
    expect(toDatetimeLocalValue({ value: undefined })).toBe("");
    expect(fromDatetimeLocalValue({ raw: "" })).toBeUndefined();
  });

  // Returned unchanged rather than thrown or dropped: `invalidDraftFields` then names it and Save
  // is blocked, instead of a `RangeError` through a render or a silent discard.
  it("returns an unparseable control value unchanged so the validator can report it", () => {
    expect(fromDatetimeLocalValue({ raw: "2026-13-45T99:99" })).toBe("2026-13-45T99:99");
  });
});
