import { expect, it, vi } from "vitest";
import { buildAccessTokenUpdatePatch } from "../access-token-forms.js";

/** Test-local copy of the host's `accessTokenWorksForChanged` rule (it lives in
 *  `packages/admin/src/security/custom-credential-forms.ts`, which integrations must not
 *  depend on — the function is an injected dep): a draft list differs from the saved one. */
function accessTokenWorksForChanged({ draft, saved = [] }: { draft: string[] | undefined; saved: readonly string[] | undefined }): boolean {
  if (draft === undefined) return false;
  const savedIds = new Set(saved);
  return draft.length !== saved.length || draft.some(id => !savedIds.has(id));
}

/** The two connection builders are injected host deps (devops owns them; integrations must not depend on
 *  devops — devops already depends on integrations). With no new token typed neither may run, so the test
 *  supplies spies and asserts they stay untouched. */
it("omits connection material when a replacement leaves the saved token blank", () => {
  const buildCredentialConnectionInput = vi.fn();
  const buildSourceControlConnectionInput = vi.fn();
  const patch = buildAccessTokenUpdatePatch({
    fields: { ref: { kind: "publish", providerId: "provider" }, name: "Renamed", token: "", values: {}, username: "" },
    nameChanged: true, hasToken: false,
    deps: { accessTokenWorksForChanged, buildCredentialConnectionInput, buildSourceControlConnectionInput },
    info: { kind: "publish", providerId: "provider", label: "Provider", vendorLabel: "Provider", purposeLabel: "Hosting",
      category: "hosting", tokenPageUrl: "", scopeGuidanceKey: "", extraFields: [] },
  });
  expect(patch).toEqual({ label: "Renamed" });
  expect(patch).not.toHaveProperty("connection");
  expect(buildCredentialConnectionInput).not.toHaveBeenCalled();
  expect(buildSourceControlConnectionInput).not.toHaveBeenCalled();
});
