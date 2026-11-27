import { expect, it } from "vitest";
import { sourceControlSavedApiKeyLabels } from "../saved-key-bindings.js";

it("allows saved custom API key fallback only for the declared GitHub binding", () => {
  expect([...sourceControlSavedApiKeyLabels]).toEqual([["github", "github"]]);
  expect(sourceControlSavedApiKeyLabels.get("gitlab")).toBeUndefined();
});
