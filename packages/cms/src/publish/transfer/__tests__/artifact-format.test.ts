import { expect, test } from "vitest";
import { PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION } from "../artifact-format.js";

test("publish content artifact format version is 1", () => {
  expect(PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION).toBe(1);
});
