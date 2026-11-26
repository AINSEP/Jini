import { expect, it } from "vitest";
import { accessTokenWorksForChanged } from "@jini-ai/admin/security/custom-credential-forms";
import { buildCredentialConnectionInput } from "@jini-ai/devops/deploy/react/rules";
import { buildSourceControlConnectionInput } from "@jini-ai/devops/source-control/react/rules";
import { buildAccessTokenUpdatePatch } from "../access-token-forms.js";

it("omits connection material when a replacement leaves the saved token blank", () => {
  const patch = buildAccessTokenUpdatePatch({
    fields: { ref: { kind: "publish", providerId: "provider" }, name: "Renamed", token: "", values: {}, username: "" },
    nameChanged: true, hasToken: false,
    deps: { accessTokenWorksForChanged, buildCredentialConnectionInput, buildSourceControlConnectionInput },
    info: { kind: "publish", providerId: "provider", label: "Provider", vendorLabel: "Provider", purposeLabel: "Hosting",
      category: "hosting", tokenPageUrl: "", scopeGuidanceKey: "", extraFields: [] },
  });
  expect(patch).toEqual({ label: "Renamed" });
  expect(patch).not.toHaveProperty("connection");
});
