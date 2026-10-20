import { describe, expect, it, vi } from "vitest";

/**
 * @file `UPLOAD_CHOICES` offers PDF only while the CMS lists it as a safe upload type, so a CMS
 * that drops it never leaves the builder offering a type the server refuses.
 */

vi.mock("@jini-ai/cms/forms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@jini-ai/cms/forms")>();
  const { "application/pdf": _pdf, ...rest } = actual.SAFE_FORM_FILE_TYPES as Record<string, unknown>;
  return { ...actual, SAFE_FORM_FILE_TYPES: rest };
});

describe("UPLOAD_CHOICES without a safe PDF type", () => {
  it("offers images and videos only", async () => {
    const { UPLOAD_CHOICES } = await import("../field-settings.js");
    expect(UPLOAD_CHOICES.map((choice) => choice.value)).toEqual(["image/*", "video/*"]);
  });
});
