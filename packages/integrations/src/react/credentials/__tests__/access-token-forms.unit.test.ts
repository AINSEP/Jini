import { expect, it } from "vitest";
import { buildAccessTokenUpdatePatch } from "../access-token-forms.js";

it("omits connection material when a replacement leaves the saved token blank", () => {
  const patch = buildAccessTokenUpdatePatch({
    fields: { ref: { kind: "publish", providerId: "provider" }, name: "Renamed", token: "", values: {}, username: "" },
    nameChanged: true, hasToken: false,
    info: { kind: "publish", providerId: "provider", label: "Provider", vendorLabel: "Provider", purposeLabel: "Hosting",
      category: "hosting", tokenPageUrl: "", scopeGuidanceKey: "", extraFields: [] },
  });
  expect(patch).toEqual({ label: "Renamed" });
  expect(patch).not.toHaveProperty("connection");
});
