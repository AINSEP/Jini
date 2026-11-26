import { describe, expect, it, vi } from "vitest";
import { createSiteSharePasswordHandler } from "../system/site-share-password.js";

describe("saved-key password request", () => {
  it("does not resolve secrets or a share ID when the owner session is refused", async () => {
    const readBackend = vi.fn();
    const shareId = vi.fn();
    const json = vi.fn();
    const failure = vi.fn();
    const handler = createSiteSharePasswordHandler({ readBackend });
    await handler({ owner: { noStore: vi.fn(), foreignWorkspace: () => false, requireSession: () => false, publishTrustContext: vi.fn(), principalId: vi.fn(), ownerPrincipalId: vi.fn(), sameOrigin: vi.fn(), json, ownerMessage: "owner required" }, principalId: vi.fn(), shareId, json, failure });
    expect(readBackend).not.toHaveBeenCalled();
    expect(shareId).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
  });

  it("answers unavailable without an incident when the backend is absent", async () => {
    const json = vi.fn();
    const failure = vi.fn();
    await createSiteSharePasswordHandler({ readBackend: () => undefined })({ owner: { noStore: vi.fn(), foreignWorkspace: () => false, requireSession: () => true, publishTrustContext: () => undefined, principalId: () => "owner", ownerPrincipalId: () => "owner", sameOrigin: () => true, json, ownerMessage: "owner required" }, principalId: () => "owner", shareId: vi.fn(), json, failure });
    expect(json).toHaveBeenCalledWith({ code: "UNAVAILABLE", message: "Export password lookup failed: saved keys are unavailable." }, 503);
    expect(failure).not.toHaveBeenCalled();
  });
});
