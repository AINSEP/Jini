import { expect, it } from "vitest";
import { PINNED_MEDIA_PROVIDER_IDS } from "../pinned-media-providers.js";

it("pins only the self-hosted Custom Media API ahead of vendor cards", () => {
  expect(PINNED_MEDIA_PROVIDER_IDS).toEqual(["custom-image"]);
});
