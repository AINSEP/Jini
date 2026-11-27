import { expect, it } from "vitest";
import { CONTENT_ENTRY_MAX_BODY_BYTES } from "../limits.js";

it("declares the content-entry request body cap as exactly one binary mebibyte", () => {
  expect(CONTENT_ENTRY_MAX_BODY_BYTES).toBe(1_048_576);
});
