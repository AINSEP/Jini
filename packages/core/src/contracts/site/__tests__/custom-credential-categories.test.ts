import { expect, it } from "vitest";
import { CUSTOM_CREDENTIAL_CATEGORIES } from "../core-custom-credential-categories.js";

it("exports the ordered closed credential category vocabulary", () => {
  expect(CUSTOM_CREDENTIAL_CATEGORIES).toEqual(["source-control", "hosting", "media", "ai", "ops", "general"]);
});
