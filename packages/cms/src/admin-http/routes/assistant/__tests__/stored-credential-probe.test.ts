import { expect, it, vi } from "vitest";
import { resolveProbeCredential } from "../stored-credential-probe.js";

it("never forwards a stored key to a different or unset endpoint", async () => {
  const input = { requestedBaseUrl: "https://other/v1", typedKey: "", useStoredCredential: true };
  const subjects = { admin: "admin credential", site: "site credential" };
  for (const baseUrl of [null, "", "  ", "https://saved/V1"]) {
    const result = await resolveProbeCredential({ input, subjects, openAdmin: async () => null, openSite: async () => ({ apiKey: "secret", baseUrl }) });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret");
    if (!result.ok) expect(result.failure.code).toBe(baseUrl?.trim() ? "STORED_CREDENTIAL_ENDPOINT_MISMATCH" : "STORED_CREDENTIAL_ENDPOINT_UNSET");
  }
  expect(await resolveProbeCredential({ input: { ...input, requestedBaseUrl: "https://saved/V1" }, subjects, openAdmin: async () => null, openSite: async () => ({ apiKey: "secret", baseUrl: " https://saved/V1/// " }) })).toEqual({ ok: true, apiKey: "secret", baseUrl: " https://saved/V1/// " });
});

it("bypasses stores for typed keys and selects admin before site", async () => {
  const openAdmin = vi.fn(async () => ({ apiKey: "admin", baseUrl: "https://saved" }));
  const openSite = vi.fn(async () => ({ apiKey: "site", baseUrl: "https://saved" }));
  const required = { openAdmin, openSite, subjects: { admin: "admin", site: "site" } };
  const input = { requestedBaseUrl: "https://saved", typedKey: " typed ", useStoredCredential: true, useAdminStoredCredential: true, principalId: "person" };
  expect(await resolveProbeCredential({ ...required, input })).toEqual({ ok: true, apiKey: " typed ", baseUrl: "https://saved" });
  expect(openAdmin).not.toHaveBeenCalled(); expect(openSite).not.toHaveBeenCalled();
  expect(await resolveProbeCredential({ ...required, input: { ...input, typedKey: "" } })).toEqual({ ok: true, apiKey: "admin", baseUrl: "https://saved" });
  expect(openAdmin.mock.calls).toEqual([[{ principalId: "person" }]]); expect(openSite).not.toHaveBeenCalled();
  await resolveProbeCredential({ ...required, input: { requestedBaseUrl: "https://saved", typedKey: "", useStoredCredential: false } });
  expect(openAdmin).toHaveBeenCalledTimes(1); expect(openSite).not.toHaveBeenCalled();
});
