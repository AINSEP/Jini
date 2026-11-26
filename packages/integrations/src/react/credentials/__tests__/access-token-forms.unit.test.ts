import { expect, it } from "vitest";
import { buildCredentialConnectionInput } from "@jini-ai/devops/deploy/react/rules";
import { buildSourceControlConnectionInput } from "@jini-ai/devops/source-control/react/rules";
import { buildAccessTokenUpdatePatch } from "../access-token-forms.js";

/** Test-local copy of the host's `accessTokenWorksForChanged` rule (it lives in
 *  `packages/admin/src/security/custom-credential-forms.ts`, which integrations must not
 *  depend on — the function is an injected dep): a draft list differs from the saved one. */
function accessTokenWorksForChanged({ draft, saved = [] }: { draft: string[] | undefined; saved: readonly string[] | undefined }): boolean {
  if (draft === undefined) return false;
  const savedIds = new Set(saved);
  return draft.length !== saved.length || draft.some(id => !savedIds.has(id));
}

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
