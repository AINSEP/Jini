import { describe, expect, it } from "vitest";

import type { FormFieldKindInfo } from "../../core/ports/forms-catalog.js";
import {
  buildFieldSettingsPatch, fieldSettingsFor, fieldTypeGroups, maxUploadMb, retypeField, settingsFormFromField, uploadChoices,
} from "../field-settings.js";
import { fakeFormsCatalog } from "./fakes/forms-catalog.js";

/**
 * @file The forms catalog is the authority for everything `field-settings.ts` used to read from
 * module-level domain tables: the kind table, the safe upload types, the file-size cap and the
 * browser-safe pattern rule. Each test hands in a catalog that differs from the recorded fixture in
 * one respect, so a function that still reads a constant (or the fixture) stays red.
 */

const MIB = 1024 * 1024;
const fixture = fakeFormsCatalog();
const withoutPdf = fakeFormsCatalog({ safeFileTypes: Object.fromEntries(Object.entries(fixture.safeFileTypes).filter(([type]) => type !== "application/pdf")) });
const field = (type: string) => ({ id: "f", label: "F", type, required: false });

describe("uploadChoices", () => {
  it("offers PDF only while the catalog lists it as a safe type", () => {
    expect(uploadChoices({ catalog: fixture }).map((choice) => choice.value)).toEqual(["image/*", "video/*", "application/pdf"]);
    expect(uploadChoices({ catalog: withoutPdf }).map((choice) => choice.value)).toEqual(["image/*", "video/*"]);
  });
});

describe("the file-size cap comes from the catalog", () => {
  const small = fakeFormsCatalog({ maxFileBytes: 2 * MIB });
  const build = (maxFileSizeMb: string) => buildFieldSettingsPatch({
    catalog: small, form: { ...settingsFormFromField({ catalog: small, field: field("file") }), maxFileSizeMb }, field: { type: "file" },
  });

  it("maxUploadMb is the catalog's byte cap in megabytes", () => {
    expect(maxUploadMb({ catalog: small })).toBe(2);
    expect(maxUploadMb({ catalog: fixture })).toBe(10);
  });

  it("clamps at the catalog's cap and refuses a size above it, naming that cap", () => {
    expect(build("2")).toMatchObject({ ok: true, patch: { maxFileSize: 2 * MIB } });
    expect(build("2.5")).toEqual({ ok: false, error: "Max size must be up to 2 MB." });
  });

  it("keeps the 10 MB wording while the catalog's cap is 10 MiB", () => {
    const patch = buildFieldSettingsPatch({ catalog: fixture, form: { ...settingsFormFromField({ catalog: fixture, field: field("file") }), maxFileSizeMb: "11" }, field: { type: "file" } });
    expect(patch).toEqual({ ok: false, error: "Max size must be up to 10 MB." });
  });
});

describe("the kind table comes from the catalog", () => {
  const signature: FormFieldKindInfo = { control: "input", htmlType: "signature" };
  const text: FormFieldKindInfo = fixture.fieldKinds["text"]!;
  const narrow = fakeFormsCatalog({ fieldKinds: { text, signature } });

  it("a type the catalog does not list gets help text only, even if the fixture lists it", () => {
    expect(fieldSettingsFor({ catalog: narrow, type: "email" })).toEqual(fieldSettingsFor({ catalog: narrow, type: "unlisted" }));
    expect(fieldSettingsFor({ catalog: narrow, type: "text" }).length).toBe(true);
  });

  it("the type picker lists exactly the catalog's types and labels an unnamed one by its type", () => {
    const listed = fieldTypeGroups({ catalog: narrow }).flatMap((entry) => entry.types);
    expect(listed).toEqual([{ type: "text", label: "Short text" }, { type: "signature", label: "signature" }]);
  });

  it("inherited object names are not kinds", () => {
    for (const name of ["constructor", "__proto__", "toString"]) {
      expect(fieldSettingsFor({ catalog: narrow, type: name })).toEqual(fieldSettingsFor({ catalog: narrow, type: "unlisted" }));
    }
  });

  it("retyping drops what the catalog's new kind does not support", () => {
    const next = retypeField({ catalog: narrow, field: { ...field("text"), placeholder: "x", maxLength: 5 }, type: "signature" });
    expect(next).toMatchObject({ id: "f", label: "F", type: "signature", required: false });
    expect(next).not.toHaveProperty("placeholder");
    expect(next).not.toHaveProperty("maxLength");
  });
});

describe("the pattern rule comes from the catalog", () => {
  const patternPatch = (catalog: ReturnType<typeof fakeFormsCatalog>, pattern: string) => buildFieldSettingsPatch({
    catalog, form: { ...settingsFormFromField({ catalog, field: field("text") }), pattern }, field: { type: "text" },
  });

  it("refuses a pattern the catalog calls unsafe and accepts one it calls safe", () => {
    expect(patternPatch(fakeFormsCatalog({ isBrowserSafePattern: () => false }), "[a-z]+")).toEqual({ ok: false, error: "That pattern isn't supported." });
    expect(patternPatch(fakeFormsCatalog({ isBrowserSafePattern: () => true }), "(?<a>x")).toMatchObject({ ok: true, patch: { pattern: "(?<a>x" } });
  });
});
