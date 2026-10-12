import { FIELD_TYPE_REGISTRY, type FieldType } from "@jini-ai/cms/forms";
import { describe, expect, it } from "vitest";

import { createFieldAttributesDialogController } from "../controllers/field-attributes-dialog.controller.js";
import {
  addOptionRow, buildFieldSettingsPatch, FIELD_TYPE_LABELS, fieldIdFromLabel, fieldSettingsFor, fieldTypeGroups, labelChangePatch,
  MAX_UPLOAD_MB, moveOptionRow, removeOptionRow, retypeField, settingsFormFromField, updateOptionRow, UPLOAD_CHOICES,
  type FieldSettings, type FieldSettingsForm, type OptionRow,
} from "../field-settings.js";
import type { AdminFormField } from "../models.js";

/**
 * @file Builder settings derived from the CMS field registry (`field-settings.ts`) and the field
 * dialog controller that drafts and submits them. Pure functions and a headless store: no React,
 * no module mocks.
 */

const field = (overrides: Partial<AdminFormField> & Pick<AdminFormField, "type">): AdminFormField =>
  ({ id: "f", label: "F", required: false, ...overrides });
const form = (overrides: Partial<FieldSettingsForm> = {}): FieldSettingsForm =>
  ({ ...settingsFormFromField({ field: field({ type: "text" }) }), ...overrides });
const rows = (...labels: Array<[string, string]>): OptionRow[] => labels.map(([label, value], index) => ({ _rowId: 1000 + index, label, value }));

/** The expected settings per registry key, written out so a registry change shows up as a diff here. */
const EXPECTED: Record<FieldType, Partial<FieldSettings>> = {
  text: { placeholder: true, length: true, pattern: true, bounds: null, defaultKind: "text" },
  textarea: { placeholder: true, length: true, pattern: true, defaultKind: "textarea" },
  email: { placeholder: true, length: true, pattern: true, defaultKind: "text" },
  phone: { placeholder: true, length: true, pattern: true, defaultKind: "text" },
  url: { placeholder: true, length: true, pattern: true, defaultKind: "text" },
  number: { placeholder: true, length: false, bounds: "number", step: true, defaultKind: "number" },
  range: { placeholder: false, bounds: "number", step: true, defaultKind: "number" },
  date: { placeholder: false, bounds: "date", step: false, defaultKind: "temporal" },
  time: { bounds: "time", defaultKind: "temporal" },
  datetime: { bounds: "datetime-local", defaultKind: "temporal" },
  select: { placeholder: true, options: true, multiple: false, defaultKind: "choice" },
  "multi-select": { placeholder: false, options: true, multiple: true, defaultKind: "choices" },
  radio: { placeholder: false, options: true, multiple: false, defaultKind: "choice" },
  checkbox: { options: false, defaultKind: "boolean" },
  "checkbox-group": { options: true, multiple: true, defaultKind: "choices" },
  toggle: { defaultKind: "boolean" },
  file: { placeholder: false, upload: true, defaultKind: null },
  hidden: { placeholder: false, helpText: false, length: true, pattern: false, defaultKind: "text" },
};

describe("fieldSettingsFor", () => {
  it.each(Object.keys(FIELD_TYPE_REGISTRY) as FieldType[])("%s offers the settings its registry kind supports", (type) => {
    expect(fieldSettingsFor({ type })).toMatchObject(EXPECTED[type]);
    expect(FIELD_TYPE_LABELS[type]).toBeTruthy();
  });

  it("an unknown stored type gets help text only, never a setting the server would refuse", () => {
    expect(fieldSettingsFor({ type: "signature" })).toEqual({
      placeholder: false, helpText: true, length: false, pattern: false, bounds: null, step: false, options: false, multiple: false, defaultKind: null, upload: false,
    });
  });
});

describe("fieldTypeGroups", () => {
  it("covers every registry type exactly once, in group order", () => {
    const groups = fieldTypeGroups({});
    expect(groups.map((entry) => entry.group)).toEqual(["Text", "Choices", "Numbers and dates", "Other"]);
    expect(groups.flatMap((entry) => entry.types.map((item) => item.type)).sort()).toEqual(Object.keys(FIELD_TYPE_REGISTRY).sort());
    expect(groups.find((entry) => entry.group === "Choices")!.types.map((item) => item.type)).toEqual(["select", "multi-select", "radio", "checkbox", "checkbox-group", "toggle"]);
    expect(groups.find((entry) => entry.group === "Other")!.types.map((item) => item.type)).toEqual(["file", "hidden"]);
  });

  it("keeps an unknown stored type as a trailing option so loading never changes it", () => {
    const other = fieldTypeGroups({ current: "signature" }).at(-1)!;
    expect(other.types.at(-1)).toEqual({ type: "signature", label: "signature" });
    expect(fieldTypeGroups({ current: "email" }).flatMap((entry) => entry.types).filter((item) => item.type === "email")).toHaveLength(1);
  });
});

describe("field ids follow labels", () => {
  it("slugs a label into the CMS id pattern", () => {
    expect(fieldIdFromLabel({ label: "Café Name!" })).toBe("cafe_name");
    expect(fieldIdFromLabel({ label: "2nd choice" })).toBe("field_2nd_choice");
    expect(fieldIdFromLabel({ label: "  ?? " })).toBe("");
    expect(fieldIdFromLabel({ label: "x".repeat(80) })).toHaveLength(60);
  });

  it("renames an unsaved id that still follows its label, never a hand-typed or saved one", () => {
    expect(labelChangePatch({ field: field({ type: "text", id: "", label: "" }), label: "Full name", isExisting: false })).toEqual({ label: "Full name", id: "full_name" });
    expect(labelChangePatch({ field: field({ type: "text", id: "full_name", label: "Full name" }), label: "Your name", isExisting: false })).toEqual({ label: "Your name", id: "your_name" });
    expect(labelChangePatch({ field: field({ type: "text", id: "custom", label: "Full name" }), label: "Your name", isExisting: false })).toEqual({ label: "Your name" });
    expect(labelChangePatch({ field: field({ type: "text", id: "full_name", label: "Full name" }), label: "Your name", isExisting: true })).toEqual({ label: "Your name" });
  });
});

describe("retypeField", () => {
  const rich = field({
    type: "text", id: "topic", label: "Topic", required: true, helpText: "Pick one", className: "wide", attributes: { "data-x": "1" },
    placeholder: "Type", maxLength: 40, minLength: 2, pattern: "[a-z]+", default: "hello",
  });

  it("drops text-only settings and seeds two options when becoming a choice field", () => {
    expect(retypeField({ field: rich, type: "select" })).toEqual({
      id: "topic", label: "Topic", type: "select", required: true, helpText: "Pick one", className: "wide", attributes: { "data-x": "1" },
      placeholder: "Type", options: [{ value: "Option 1", label: "Option 1" }, { value: "Option 2", label: "Option 2" }],
    });
  });

  it("keeps existing options, and copies them rather than sharing the array", () => {
    const options = [{ value: "a", label: "A" }];
    const next = retypeField({ field: field({ type: "select", options, default: "a" }), type: "radio" });
    expect(next.options).toEqual(options);
    expect(next.options).not.toBe(options);
    expect(next.default).toBe("a");
  });

  it("keeps bounds only between types with the same bound format, and defaults only when their shape matches", () => {
    const number = field({ type: "number", min: 1, max: 9, step: 2, default: 5 });
    expect(retypeField({ field: number, type: "range" })).toMatchObject({ min: 1, max: 9, step: 2, default: 5 });
    const asDate = retypeField({ field: number, type: "date" });
    expect([asDate.min, asDate.max, asDate.step, asDate.default]).toEqual([undefined, undefined, undefined, undefined]);
    expect(retypeField({ field: field({ type: "date", min: "2026-01-01", default: "2026-02-01" }), type: "time" })).not.toHaveProperty("min");
    expect(retypeField({ field: field({ type: "select", options: [{ value: "a", label: "A" }], default: "a" }), type: "multi-select" })).not.toHaveProperty("default");
  });

  it("keeps upload limits between file fields and drops required for a hidden field", () => {
    expect(retypeField({ field: field({ type: "file", accept: ["image/*"], maxFileSize: 1024 }), type: "file" })).toMatchObject({ accept: ["image/*"], maxFileSize: 1024 });
    expect(retypeField({ field: rich, type: "hidden" })).toMatchObject({ required: false, maxLength: 40, minLength: 2 });
    expect(retypeField({ field: rich, type: "hidden" })).not.toHaveProperty("helpText");
  });
});

describe("option rows", () => {
  it("a value that mirrors its label follows label edits; an edited value stays put", () => {
    const start = rows(["Red", "Red"], ["Blue", "navy"]);
    expect(updateOptionRow({ rows: start, rowId: 1000, patch: { label: "Rose" } })[0]).toMatchObject({ label: "Rose", value: "Rose" });
    expect(updateOptionRow({ rows: start, rowId: 1001, patch: { label: "Sky" } })[1]).toMatchObject({ label: "Sky", value: "navy" });
    expect(updateOptionRow({ rows: start, rowId: 1000, patch: { value: "r" } })[0]).toMatchObject({ label: "Red", value: "r" });
  });

  it("adds a blank row with a fresh key, removes by key, and moves within bounds only", () => {
    const start = rows(["A", "a"], ["B", "b"], ["C", "c"]);
    const added = addOptionRow({ rows: start });
    expect(added).toHaveLength(4);
    expect(added[3]).toMatchObject({ label: "", value: "" });
    expect(new Set(added.map((row) => row._rowId)).size).toBe(4);
    expect(removeOptionRow({ rows: start, rowId: 1001 }).map((row) => row.label)).toEqual(["A", "C"]);
    expect(moveOptionRow({ rows: start, rowId: 1001, offset: -1 }).map((row) => row.label)).toEqual(["B", "A", "C"]);
    expect(moveOptionRow({ rows: start, rowId: 1000, offset: -1 })).toBe(start);
    expect(moveOptionRow({ rows: start, rowId: 1002, offset: 1 })).toBe(start);
    expect(moveOptionRow({ rows: start, rowId: 9, offset: 1 })).toBe(start);
  });
});

describe("settingsFormFromField", () => {
  it("drafts every stored setting as text", () => {
    const draft = settingsFormFromField({ field: field({ type: "file", accept: ["application/pdf"], maxFileSize: 5 * 1024 * 1024, helpText: "PDF" }) });
    expect(draft).toMatchObject({ helpText: "PDF", accept: ["application/pdf"], maxFileSizeMb: "5", defaultText: "", defaultChoices: [] });
    expect(settingsFormFromField({ field: field({ type: "number", min: 0, max: 10, step: 0.5, default: 3 }) })).toMatchObject({ min: "0", max: "10", step: "0.5", defaultText: "3" });
    expect(settingsFormFromField({ field: field({ type: "select", options: [{ value: "a", label: "A" }], default: "a" }) }).defaultChoices).toEqual(["a"]);
    expect(settingsFormFromField({ field: field({ type: "checkbox-group", options: [{ value: "a", label: "A" }], default: ["a"] }) }).defaultChoices).toEqual(["a"]);
    expect(settingsFormFromField({ field: field({ type: "checkbox", checkboxValue: "yes", default: "yes" }) }).defaultChecked).toBe(true);
    expect(settingsFormFromField({ field: field({ type: "toggle", default: true }) }).defaultChecked).toBe(true);
  });
});

describe("buildFieldSettingsPatch", () => {
  const patch = (type: string, overrides: Partial<FieldSettingsForm>, checkboxValue?: string) =>
    buildFieldSettingsPatch({ form: form(overrides), field: { type, ...(checkboxValue === undefined ? {} : { checkboxValue }) } });

  it.each(["text", "textarea", "email", "phone", "url", "hidden"])("%s clears a stored max length with null, including on the wire", (type) => {
    const original = field({ type, maxLength: 40 });
    const controller = createFieldAttributesDialogController({ field: original });
    controller.setSettings({ patch: { maxLength: " " } });
    const result = controller.submit({});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.patch).toHaveProperty("maxLength", null);
    const saved = JSON.parse(JSON.stringify({ ...original, ...result.patch }));
    expect(saved.maxLength).toBeNull();
    expect(original.maxLength).toBe(40);
  });

  it.each(["range", "checkbox", "file", "signature"])("%s omits unsupported max length after replacing the field's type", (type) => {
    const original = field({ type: "text", maxLength: 40, minLength: 2, pattern: "[a-z]+", placeholder: "Name" });
    const retyped = retypeField({ field: original, type });
    const result = buildFieldSettingsPatch({ form: settingsFormFromField({ field: retyped }), field: retyped });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.patch).not.toHaveProperty("maxLength");
    const saved = { ...retyped, ...result.patch };
    for (const key of ["maxLength", "minLength", "pattern", "placeholder"]) {
      expect(JSON.parse(JSON.stringify(saved))).not.toHaveProperty(key);
    }
    expect(original.maxLength).toBe(40);
  });

  it("text: keeps placeholder, help, lengths and a safe pattern; clears what is blank", () => {
    expect(patch("text", { placeholder: "Name", helpText: "Legal name", minLength: "2", maxLength: "40", pattern: "[a-z]+", defaultText: "Ann" })).toEqual({ ok: true, patch: {
      placeholder: "Name", helpText: "Legal name", minLength: 2, maxLength: 40, pattern: "[a-z]+", min: undefined, max: undefined, step: undefined, options: undefined, default: "Ann",
    } });
    expect(patch("text", { placeholder: " ", helpText: "" })).toMatchObject({ ok: true, patch: { placeholder: undefined, helpText: undefined, default: undefined } });
  });

  it.each([
    ["text", { minLength: "1.5" }, "Length must be a whole number."],
    ["text", { maxLength: "-1" }, "Length must be a whole number."],
    ["text", { minLength: "9", maxLength: "3" }, "Minimum must not be above maximum."],
    ["text", { pattern: "(a|b)" }, "That pattern isn't supported."],
    ["number", { min: "x" }, "Enter numbers for min, max and step."],
    ["number", { max: "x" }, "Enter numbers for min, max and step."],
    ["range", { step: "x" }, "Enter numbers for min, max and step."],
    ["range", { step: "0" }, "Step must be above 0."],
    ["number", { min: "10", max: "1" }, "Minimum must not be above maximum."],
    ["date", { min: "2026-12-01", max: "2026-01-01" }, "Minimum must not be above maximum."],
    ["number", { defaultText: "many" }, "Default must be a number."],
    ["file", { maxFileSizeMb: "0" }, "Max size must be up to 10 MB."],
    ["file", { maxFileSizeMb: String(MAX_UPLOAD_MB + 1) }, "Max size must be up to 10 MB."],
    ["file", { maxFileSizeMb: "big" }, "Max size must be up to 10 MB."],
  ] as const)("%s %o is refused: %s", (type, overrides, error) => {
    expect(patch(type, overrides)).toEqual({ ok: false, error });
  });

  it("choices: skips blank rows, needs one option with a label and a unique value, and drops defaults no longer offered", () => {
    expect(patch("select", { options: rows(["", ""]) })).toEqual({ ok: false, error: "Add at least one option." });
    expect(patch("select", { options: rows(["A", ""]) })).toEqual({ ok: false, error: "Each option needs a label and a unique value." });
    expect(patch("select", { options: rows(["A", "a"], ["B", "a"]) })).toEqual({ ok: false, error: "Each option needs a label and a unique value." });
    expect(patch("select", { options: rows([" A ", " a "], ["", ""], ["B", "b"]), defaultChoices: ["gone", "b"] })).toMatchObject({ ok: true, patch: {
      options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "b",
    } });
    expect(patch("checkbox-group", { options: rows(["A", "a"], ["B", "b"]), defaultChoices: ["b", "gone", "a"] })).toMatchObject({ ok: true, patch: { default: ["b", "a"] } });
    expect(patch("multi-select", { options: rows(["A", "a"]), defaultChoices: ["gone"] })).toMatchObject({ ok: true, patch: { default: undefined } });
  });

  it("boolean defaults: true for a plain box, the authored value for a box with checkboxValue, nothing when unchecked", () => {
    expect(patch("toggle", { defaultChecked: true })).toMatchObject({ ok: true, patch: { default: true } });
    expect(patch("checkbox", { defaultChecked: true }, "yes")).toMatchObject({ ok: true, patch: { default: "yes" } });
    expect(patch("checkbox", { defaultChecked: true }, "")).toMatchObject({ ok: true, patch: { default: "" } });
    expect(patch("checkbox", { defaultChecked: false }, "yes")).toMatchObject({ ok: true, patch: { default: undefined } });
  });

  it("numbers and dates: parses numeric bounds, keeps native date strings, ignores lengths the type lacks", () => {
    expect(patch("range", { min: "0", max: "100", step: "5", defaultText: "25", maxLength: "9" })).toMatchObject({ ok: true, patch: {
      min: 0, max: 100, step: 5, default: 25, minLength: undefined, placeholder: undefined,
    } });
    expect(patch("datetime", { min: "2026-01-01T09:00", max: "", defaultText: "2026-03-01T10:00" })).toMatchObject({ ok: true, patch: {
      min: "2026-01-01T09:00", max: undefined, default: "2026-03-01T10:00",
    } });
  });

  it("uploads: no ticked type means every safe type; megabytes become bytes, capped at the CMS limit", () => {
    expect(UPLOAD_CHOICES.map((choice) => choice.value)).toEqual(["image/*", "video/*", "application/pdf"]);
    expect(patch("file", { accept: [], maxFileSizeMb: "" })).toMatchObject({ ok: true, patch: { accept: undefined, maxFileSize: undefined, default: undefined } });
    expect(patch("file", { accept: ["image/*"], maxFileSizeMb: "2.5" })).toMatchObject({ ok: true, patch: { accept: ["image/*"], maxFileSize: 2621440 } });
    expect(patch("file", { maxFileSizeMb: String(MAX_UPLOAD_MB) })).toMatchObject({ ok: true, patch: { maxFileSize: MAX_UPLOAD_MB * 1024 * 1024 } });
  });

  it("hidden: no help text or pattern even when the draft has them", () => {
    expect(patch("hidden", { helpText: "x", pattern: "[a-z]+", defaultText: "src" })).toMatchObject({ ok: true, patch: { helpText: undefined, pattern: undefined, default: "src" } });
  });
});

describe("field settings dialog controller", () => {
  const select = field({ type: "select", id: "topic", label: "Topic", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], className: "old" });

  it("submits the settings patch merged with the class and attribute patch", () => {
    const controller = createFieldAttributesDialogController({ field: select });
    const [first] = controller.getSnapshot().settings.options;
    controller.addOption({});
    const added = controller.getSnapshot().settings.options.at(-1)!;
    controller.updateOption({ rowId: added._rowId, patch: { label: "C" } });
    controller.moveOption({ rowId: added._rowId, offset: -1 });
    controller.removeOption({ rowId: first!._rowId });
    controller.toggleDefaultChoice({ value: "C", on: true, single: true });
    controller.setSettings({ patch: { helpText: "Pick one" } });
    controller.update({ key: "className", value: () => "wide" });
    expect(controller.submit({})).toEqual({ ok: true, patch: {
      placeholder: undefined, pattern: undefined, minLength: undefined, min: undefined, max: undefined, step: undefined,
      helpText: "Pick one", options: [{ value: "C", label: "C" }, { value: "b", label: "B" }], default: "C", className: "wide", attributes: undefined,
    } });
    expect(controller.getSnapshot().error).toBeNull();
  });

  it("a single-choice default replaces the selection; clearing it empties it; multi toggles add and remove", () => {
    const single = createFieldAttributesDialogController({ field: select });
    single.toggleDefaultChoice({ value: "a", on: true, single: true });
    single.toggleDefaultChoice({ value: "b", on: true, single: true });
    expect(single.getSnapshot().settings.defaultChoices).toEqual(["b"]);
    single.toggleDefaultChoice({ value: "", on: true, single: true });
    expect(single.getSnapshot().settings.defaultChoices).toEqual([]);
    const multi = createFieldAttributesDialogController({ field: { ...select, type: "checkbox-group" } });
    multi.toggleDefaultChoice({ value: "a", on: true, single: false });
    multi.toggleDefaultChoice({ value: "a", on: true, single: false });
    multi.toggleDefaultChoice({ value: "b", on: true, single: false });
    multi.toggleDefaultChoice({ value: "a", on: false, single: false });
    expect(multi.getSnapshot().settings.defaultChoices).toEqual(["b"]);
  });

  it("toggles accepted upload types", () => {
    const controller = createFieldAttributesDialogController({ field: field({ type: "file" }) });
    controller.toggleAccept({ value: "image/*", on: true });
    controller.toggleAccept({ value: "application/pdf", on: true });
    controller.toggleAccept({ value: "image/*", on: false });
    expect(controller.getSnapshot().settings.accept).toEqual(["application/pdf"]);
  });

  it("a settings error wins over an attribute error and is stored; fixing it clears the stored error", () => {
    const controller = createFieldAttributesDialogController({ field: field({ type: "number" }) });
    controller.setSettings({ patch: { min: "5", max: "1" } });
    controller.addRow({});
    const row = controller.getSnapshot().rows.at(-1)!;
    controller.updateRow({ rowId: row._rowId, patch: { name: "onclick", value: "x" } });
    expect(controller.submit({})).toEqual({ ok: false, error: "Minimum must not be above maximum." });
    expect(controller.getSnapshot().error).toBe("Minimum must not be above maximum.");
    controller.setSettings({ patch: { max: "9" } });
    expect(controller.submit({})).toMatchObject({ ok: false, error: expect.stringContaining('Attribute "onclick"') });
    controller.removeRow({ rowId: row._rowId });
    expect(controller.submit({})).toMatchObject({ ok: true, patch: { min: 5, max: 9 } });
    expect(controller.getSnapshot().error).toBeNull();
  });
});
